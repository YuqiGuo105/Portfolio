'use client';

import { v4 as uuid } from 'uuid';

const createWorker = () => new Worker(new URL('./sandboxWorker.js', import.meta.url), { type: 'module' });

export class WorkerPool {
  constructor(size = 3) {
    this.size = size;
    this.workers = [];
    this.queue = [];
    this.activeJobs = new Map();
    this.listeners = new Set();
    for (let i = 0; i < size; i += 1) {
      this.workers.push(this.spawnWorker(i));
    }
  }

  spawnWorker(index) {
    const worker = createWorker();
    worker.onmessage = (event) => {
      const { id, result, error } = event.data;
      const job = this.activeJobs.get(id);
      if (!job) return;
      this.activeJobs.delete(id);
      worker.__currentJob = null;
      if (error) job.reject(new Error(error));
      else job.resolve(result);
      this.schedule();
      this.emit();
    };
    worker.onerror = (error) => {
      console.error('Worker error', error);
    };
    return worker;
  }

  emit() {
    const snapshot = {
      queue: [...this.queue],
      activeJobs: Array.from(this.activeJobs.values()).map((job) => ({ id: job.id, task: job.task })),
    };
    this.listeners.forEach((listener) => listener(snapshot));
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  schedule() {
    if (this.queue.length === 0) return;
    if (this.activeJobs.size >= this.size) return;

    const job = this.queue.shift();
    if (!job) return;

    const worker = this.workers.find((candidate) => candidate && !candidate.__currentJob);
    const targetWorker = worker ?? this.workers[0];
    if (!targetWorker) return;
    this.activeJobs.set(job.id, job);
    targetWorker.__currentJob = job.id;
    targetWorker.postMessage({ id: job.id, task: job.task, payload: job.payload });
    this.emit();
  }

  run(task, payload) {
    const id = uuid();
    return new Promise((resolve, reject) => {
      const job = { id, task, payload, resolve, reject };
      this.queue.push(job);
      this.schedule();
      this.emit();
    });
  }

  destroy() {
    this.workers.forEach((worker) => worker?.terminate());
    this.workers = [];
    this.queue = [];
    this.activeJobs.clear();
  }
}

let pool;

export const getWorkerPool = () => {
  if (!pool) pool = new WorkerPool(3);
  return pool;
};
