// 二维码窗口的桥：只有「刷新」一个动作——点了让主进程重算 IP 并重画二维码
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('qr', { refresh: () => ipcRenderer.send('phone:refresh-qr') });
