'use client';

import localforage from 'localforage';
import { usePermissionStore } from '../ipc/usePermissionStore';

const encoder = new TextEncoder();

class FileSystem {
  constructor() {
    this.instance = localforage.createInstance({ name: 'web-os', storeName: 'fs' });
    this.initialized = false;
  }

  async ensurePermission() {
    const ensure = usePermissionStore.getState().ensurePermission;
    const granted = await ensure('fs', 'Grant access to the virtual file system.');
    if (!granted) throw new Error('File system permission denied');
  }

  async init() {
    if (this.initialized) return;
    await this.ensurePermission();
    this.initialized = true;
  }

  async writeFile(path, content) {
    await this.init();
    const now = Date.now();
    const payload = {
      path,
      content,
      size: encoder.encode(typeof content === 'string' ? content : JSON.stringify(content)).length,
      updatedAt: now,
      createdAt: now,
      type: typeof content,
    };
    await this.instance.setItem(path, payload);
    return payload;
  }

  async readFile(path) {
    await this.init();
    return this.instance.getItem(path);
  }

  async deleteFile(path) {
    await this.init();
    return this.instance.removeItem(path);
  }

  async listFiles() {
    await this.init();
    const keys = await this.instance.keys();
    const files = await Promise.all(keys.map((key) => this.instance.getItem(key)));
    return files.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async renameFile(oldPath, newPath) {
    await this.init();
    const file = await this.instance.getItem(oldPath);
    if (!file) return null;
    await this.instance.removeItem(oldPath);
    const updated = { ...file, path: newPath, updatedAt: Date.now() };
    await this.instance.setItem(newPath, updated);
    return updated;
  }

  async getUsage() {
    await this.init();
    const files = await this.listFiles();
    const total = files.reduce((sum, file) => sum + (file?.size ?? 0), 0);
    const quota = await navigator.storage?.estimate?.();
    return {
      used: total,
      quota: quota?.quota ?? 0,
      usageDetails: files,
    };
  }
}

export const fileSystem = new FileSystem();
