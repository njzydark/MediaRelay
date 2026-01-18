class LockTask {
  private taskMap: Map<string, Promise<any>> = new Map();

  register(taskId: string, cb: () => Promise<any>) {
    const existingTask = this.taskMap.get(taskId);

    if (existingTask) {
      return existingTask;
    }

    const task = (async () => {
      try {
        return await cb();
      } finally {
        this.taskMap.delete(taskId);
      }
    })();

    this.taskMap.set(taskId, task);
    return task;
  }
}

export const lockTask = new LockTask();
