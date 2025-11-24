const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { mergePdfs, splitPdf, jpgToPdf, ocrPdf, processAi } = require('./controllers');

// Configuration
require('dotenv').config();
const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// File Upload Config
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// Ensure uploads directory exists
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// --- API Routes ---

// 1. Merge PDF
app.post('/api/merge', upload.array('files', 10), mergePdfs);

// 2. Split PDF
app.post('/api/split', upload.single('file'), splitPdf);

// 3. JPG to PDF
app.post('/api/jpg-to-pdf', upload.array('files', 20), jpgToPdf);

// 4. OCR PDF
app.post('/api/ocr', upload.single('file'), ocrPdf);

// 5. AI Process (Proxy to keep API Key secure)
app.post('/api/ai-process', processAi);

// Health Check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0' });
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Uploads directory: ${path.join(__dirname, 'uploads')}`);
});
