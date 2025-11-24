const { PDFDocument } = require('pdf-lib');
const fs = require('fs').promises;
const path = require('path');
const Tesseract = require('tesseract.js');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// --- Helper: Cleanup uploaded files ---
const cleanupFiles = async (files) => {
  if (!files) return;
  const fileArray = Array.isArray(files) ? files : [files];
  for (const file of fileArray) {
    try {
      await fs.unlink(file.path);
    } catch (err) {
      console.error(`Failed to delete file ${file.path}:`, err);
    }
  }
};

// --- 1. Merge PDFs ---
exports.mergePdfs = async (req, res) => {
  try {
    if (!req.files || req.files.length < 2) {
      return res.status(400).json({ error: 'Please upload at least 2 PDF files.' });
    }

    const mergedPdf = await PDFDocument.create();

    for (const file of req.files) {
      const fileBuffer = await fs.readFile(file.path);
      const pdf = await PDFDocument.load(fileBuffer);
      const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
      copiedPages.forEach((page) => mergedPdf.addPage(page));
    }

    const pdfBytes = await mergedPdf.save();
    
    // Cleanup
    await cleanupFiles(req.files);

    // Send response
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=merged_document.pdf');
    res.send(Buffer.from(pdfBytes));

  } catch (error) {
    console.error('Merge Error:', error);
    await cleanupFiles(req.files);
    res.status(500).json({ error: 'Failed to merge PDFs', details: error.message });
  }
};

// --- 2. Split PDF ---
exports.splitPdf = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }

    const { range } = req.body; // Expects string like "1-3, 5"
    // Note: In a real app, parse 'range' logic robustly. 
    // Here we assume a simple "1-N" or single page for demonstration.
    
    const fileBuffer = await fs.readFile(req.file.path);
    const srcPdf = await PDFDocument.load(fileBuffer);
    const newPdf = await PDFDocument.create();

    // Simple parser for "1-5" type ranges (1-based index to 0-based)
    const totalPages = srcPdf.getPageCount();
    const indicesToKeep = new Set();

    if (!range) {
      // Default to first page if no range
      indicesToKeep.add(0);
    } else {
      const parts = range.split(',');
      parts.forEach(part => {
        if (part.includes('-')) {
          const [start, end] = part.split('-').map(n => parseInt(n.trim()) - 1);
          for (let i = start; i <= end; i++) {
            if (i >= 0 && i < totalPages) indicesToKeep.add(i);
          }
        } else {
          const page = parseInt(part.trim()) - 1;
          if (page >= 0 && page < totalPages) indicesToKeep.add(page);
        }
      });
    }

    const copiedPages = await newPdf.copyPages(srcPdf, Array.from(indicesToKeep));
    copiedPages.forEach(page => newPdf.addPage(page));

    const pdfBytes = await newPdf.save();

    await cleanupFiles(req.file);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=split_${req.file.originalname}`);
    res.send(Buffer.from(pdfBytes));

  } catch (error) {
    console.error('Split Error:', error);
    await cleanupFiles(req.file);
    res.status(500).json({ error: 'Failed to split PDF', details: error.message });
  }
};

// --- 3. JPG to PDF ---
exports.jpgToPdf = async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No images uploaded.' });
    }

    const pdfDoc = await PDFDocument.create();

    for (const file of req.files) {
      const imageBuffer = await fs.readFile(file.path);
      let image;
      // Support JPG and PNG
      if (file.mimetype === 'image/jpeg' || file.mimetype === 'image/jpg') {
        image = await pdfDoc.embedJpg(imageBuffer);
      } else if (file.mimetype === 'image/png') {
        image = await pdfDoc.embedPng(imageBuffer);
      } else {
        continue; // Skip unsupported
      }

      const page = pdfDoc.addPage([image.width, image.height]);
      page.drawImage(image, {
        x: 0,
        y: 0,
        width: image.width,
        height: image.height,
      });
    }

    const pdfBytes = await pdfDoc.save();
    await cleanupFiles(req.files);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=images_converted.pdf');
    res.send(Buffer.from(pdfBytes));

  } catch (error) {
    console.error('JPG to PDF Error:', error);
    await cleanupFiles(req.files);
    res.status(500).json({ error: 'Failed to convert images to PDF' });
  }
};

// --- 4. OCR PDF ---
exports.ocrPdf = async (req, res) => {
  try {
    // Note: Standard tesseract.js works best on Images. 
    // For PDF OCR in Node, usually we convert PDF -> Images -> Tesseract.
    // For this code snippet, we'll assume the user uploaded an Image they want OCR'd 
    // OR we return a mocked response if it's a PDF because pure Node PDF-to-Image requires system binaries (poppler).
    
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }

    // If it's an image, we can process it directly
    if (req.file.mimetype.startsWith('image/')) {
        const imageBuffer = await fs.readFile(req.file.path);
        const { data: { text } } = await Tesseract.recognize(imageBuffer, 'eng');
        
        await cleanupFiles(req.file);
        return res.json({ success: true, text });
    } 
    
    // If it's a PDF, without Poppler/Ghostscript installed on the server, we cannot easily convert to image for Tesseract.
    // In a real production env, you would use `pdf-poppler` here.
    // Returning a simulated response for PDF to demonstrate the endpoint contract.
    await cleanupFiles(req.file);
    res.json({ 
        success: true, 
        text: "Backend Note: PDF OCR requires system libraries (Poppler/Ghostscript) to convert pages to images first. Please upload an image file to test the Tesseract integration strictly in Node.js, or install poppler-utils on your server." 
    });

  } catch (error) {
    console.error('OCR Error:', error);
    await cleanupFiles(req.file);
    res.status(500).json({ error: 'OCR failed' });
  }
};

// --- 5. AI Process (Gemini Proxy) ---
exports.processAi = async (req, res) => {
  try {
    const { prompt, model = 'gemini-2.5-flash' } = req.body;
    
    if (!process.env.API_KEY) {
       return res.status(500).json({ error: 'Server API_KEY not configured' });
    }

    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
        model: model,
        contents: prompt,
    });

    res.json({ text: response.text });

  } catch (error) {
    console.error('AI Error:', error);
    res.status(500).json({ error: 'AI processing failed' });
  }
};
