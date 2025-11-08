// server.js
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();

// Security middleware
app.use(helmet());
app.use(cors({
  origin: [
    'https://webhost.zone.id',
    'https://www.webhost.zone.id',
    'http://localhost:3000'
  ],
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Ensure sites directory exists
const sitesDir = path.join(__dirname, 'sites');
if (!fs.existsSync(sitesDir)) {
  fs.mkdirSync(sitesDir, { recursive: true });
}

// Storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const subdomain = req.body.subdomain;
    if (!subdomain) {
      return cb(new Error('Subdomain is required'), null);
    }
    
    const userDir = path.join(sitesDir, subdomain);
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }
    
    cb(null, userDir);
  },
  filename: (req, file, cb) => {
    // Sanitize filename
    const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    cb(null, sanitizedName);
  }
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.html', '.css', '.js', '.txt', '.json', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp'];
    const fileExt = path.extname(file.originalname).toLowerCase();
    
    if (allowedTypes.includes(fileExt)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${fileExt} not allowed`), false);
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
    files: 20
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Upload files
app.post('/api/upload', upload.array('files'), (req, res) => {
  try {
    const { subdomain } = req.body;
    const files = req.files;

    if (!subdomain) {
      return res.status(400).json({ error: 'Subdomain is required' });
    }

    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    // Validate subdomain
    const subdomainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;
    if (!subdomainRegex.test(subdomain)) {
      return res.status(400).json({ 
        error: 'Invalid subdomain. Use 3-63 characters, letters, numbers, hyphens. Must start and end with letter/number.' 
      });
    }

    // Check if index.html exists
    const hasIndexHtml = files.some(file => 
      file.originalname.toLowerCase() === 'index.html'
    );

    if (!hasIndexHtml) {
      return res.status(400).json({ 
        error: 'You must include an index.html file' 
      });
    }

    res.json({
      success: true,
      message: 'Files uploaded successfully!',
      subdomain: subdomain,
      url: `https://${subdomain}.webhost.zone.id`,
      files: files.map(f => ({
        name: f.originalname,
        size: f.size,
        path: f.path
      }))
    });

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get file list for a subdomain
app.get('/api/files/:subdomain', (req, res) => {
  try {
    const { subdomain } = req.params;
    const siteDir = path.join(sitesDir, subdomain);
    
    if (!fs.existsSync(siteDir)) {
      return res.status(404).json({ error: 'Site not found' });
    }
    
    const files = fs.readdirSync(siteDir).map(filename => {
      const filePath = path.join(siteDir, filename);
      const stats = fs.statSync(filePath);
      return {
        name: filename,
        size: stats.size,
        modified: stats.mtime
      };
    });
    
    res.json({ files });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete site
app.delete('/api/sites/:subdomain', (req, res) => {
  try {
    const { subdomain } = req.params;
    const siteDir = path.join(sitesDir, subdomain);
    
    if (!fs.existsSync(siteDir)) {
      return res.status(404).json({ error: 'Site not found' });
    }
    
    // Delete directory recursively
    fs.rmSync(siteDir, { recursive: true, force: true });
    
    res.json({ success: true, message: 'Site deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all sites (admin endpoint)
app.get('/api/sites', (req, res) => {
  try {
    if (!fs.existsSync(sitesDir)) {
      return res.json({ sites: [] });
    }
    
    const sites = fs.readdirSync(sitesDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => {
        const siteDir = path.join(sitesDir, dirent.name);
        const files = fs.readdirSync(siteDir);
        return {
          name: dirent.name,
          url: `https://${dirent.name}.webhost.zone.id`,
          fileCount: files.length,
          files: files
        };
      });
    
    res.json({ 
      total: sites.length,
      sites: sites 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Serve static files for subdomains
app.use('/sites/:subdomain', (req, res) => {
  const { subdomain } = req.params;
  const siteDir = path.join(sitesDir, subdomain);
  const requestedFile = req.path === '/' ? 'index.html' : req.path.slice(1);
  
  if (!fs.existsSync(siteDir)) {
    return res.status(404).json({ error: 'Site not found' });
  }
  
  const filePath = path.join(siteDir, requestedFile);
  
  if (!fs.existsSync(filePath)) {
    // Fallback to index.html for SPA routing
    const indexPath = path.join(siteDir, 'index.html');
    if (fs.existsSync(indexPath)) {
      return res.sendFile(indexPath);
    }
    return res.status(404).json({ error: 'File not found' });
  }
  
  // Set appropriate content type
  const ext = path.extname(filePath).toLowerCase();
  const contentTypes = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.json': 'application/json',
    '.txt': 'text/plain'
  };
  
  const contentType = contentTypes[ext] || 'application/octet-stream';
  res.setHeader('Content-Type', contentType);
  res.sendFile(filePath);
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`🚀 Koyeb API Server running on port ${PORT}`);
  console.log(`📁 Sites directory: ${sitesDir}`);
});
