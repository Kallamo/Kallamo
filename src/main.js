const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs'); 
const { extractText } = require('unpdf'); 

function createWindow () {
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 600,
    frame: false, 
    backgroundColor: '#011419',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  
  mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Custom title bar buttons communication
ipcMain.on('window-minimize', (event) => {
  BrowserWindow.fromWebContents(event.sender).minimize();
});

ipcMain.on('window-maximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win.isMaximized()) {
    win.unmaximize();
  } else {
    win.maximize();
  }
});

ipcMain.on('window-close', (event) => {
  BrowserWindow.fromWebContents(event.sender).close();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// ==========================================
// --- BACKEND SERVICES (IPC HANDLERS) ---
// ==========================================

// Reads the PDF using the modern unpdf library and returns clean text
ipcMain.handle('parse-pdf', async (event, filePath) => {
  try {
      console.log(`Extracting text from PDF: ${filePath}`);
      
      // 1. Read file as Node.js Buffer
      const nodeBuffer = fs.readFileSync(filePath);
      
      // 2. Convert Buffer to standard Uint8Array for unpdf
      const uint8Array = new Uint8Array(nodeBuffer);
      
      // 3. Extract text
      let { text } = await extractText(uint8Array);
      
      // 4. BUGFIX: Ensure text is a single continuous string
      // If unpdf returns an array of pages, join them with double line breaks
      if (Array.isArray(text)) {
          text = text.join('\n\n');
      } else if (typeof text !== 'string') {
          text = String(text);
      }
      
      return text;
  } catch (error) {
      console.error("Error extracting PDF in main process:", error);
      throw error;
  }
});