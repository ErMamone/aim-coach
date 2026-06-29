import { app as ElectronApp, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { OverlayService } from './services/overlay.service';
import { OverlayHotkeysService } from './services/overlay-hotkeys.service';
import { CoachService } from './services/coach.service';

let mainWindow: BrowserWindow | null = null;

// El console.log del proceso main no se ve confiablemente en la terminal de
// Windows -> mandamos todos los logs a la ventana de config para verlos en pantalla.
const sendLog = (message: string, ...args: any[]): void => {
  console.log(message, ...args);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('console-message', message, ...args);
  }
};

const createMainWindow = (): void => {
  mainWindow = new BrowserWindow({
    width: 820,
    height: 620,
    show: true,
    title: 'Aim Coach',
    backgroundColor: '#12141a',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      devTools: true,
      preload: path.join(__dirname, '../preload/preload.js'),
    },
  });

  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
};

const overlayService = new OverlayService();
const overlayHotkeys = new OverlayHotkeysService(overlayService);
const coach = new CoachService(overlayService);

// Todos los logs convergen a la ventana de config.
overlayService.on('log', (m: string, ...a: any[]) => sendLog('OVERLAY: ' + m, ...a));
overlayHotkeys.on('log', (m: string, ...a: any[]) => sendLog('HOTKEY: ' + m, ...a));
coach.on('log', (m: string, ...a: any[]) => sendLog(m, ...a));

// Diagnostico del package manager de Overwolf: ver si los paquetes (overlay/gep)
// cargan, fallan o crashean. El overlay solo se activa con un juego soportado corriendo.
const owPackages = (ElectronApp as any).overwolf?.packages;
if (owPackages) {
  owPackages.on('ready', (_e: any, name: string, version: string) =>
    sendLog(`PKG ready: ${name} v${version}`)
  );
  owPackages.on('failed-to-initialize', (_e: any, name: string, ...a: any[]) =>
    sendLog(`PKG failed-to-initialize: ${name}`, ...a)
  );
  owPackages.on('crashed', (_e: any, ...a: any[]) => sendLog('PKG crashed', ...a));
} else {
  sendLog('PKG: app.overwolf.packages no disponible (¿estás corriendo con ow-electron?)');
}

// IPC desde la ventana de config (preload expone window.osr.*).
ipcMain.handle('createOSR', async () => {
  await coach.showOverlay();
});
ipcMain.handle('toggleOSRVisibility', async () => {
  coach.toggleOverlay();
});
ipcMain.handle('updateHotkey', async () => {
  overlayHotkeys.updateHotkey();
});

ElectronApp.whenReady().then(() => {
  createMainWindow();
  sendLog('APP UID (OVERWOLF_APP_UID): ' + (process.env.OVERWOLF_APP_UID ?? '(no seteado)'));
  coach.start();
});

ElectronApp.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    ElectronApp.quit();
  }
});
