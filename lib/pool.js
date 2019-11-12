'use strict';

// system
const cp = require('child_process'),
      os = require('os'),
      EventEmitter = require('events');
      
// modules
const Task = require('./task');

class Pool extends EventEmitter {

  constructor (path, options) {
    super();
    this.path = path;
    this.options = Object.assign({
      workers: os.cpus().length,
      arguments: [],
      maxTasksPerWorker: -1,
    }, options);

    this.workers = {};
    this.idle = [];
    this.tasks = [];
  }

  available () {
    const busy = Object.keys(this.workers).length - this.idle.length;
    return this.options.workers - busy;
  }

  total () {
    return this.options.workers;
  }

  _spawn () {
    const child = cp.fork(this.path, this.options.arguments);

    child._ready_ = false;
    child._taskCount_ = 0;
    // Wait for child to be ready to receive messages.
    const readyListener = (msg) => {
      if (msg.type === 'ready') {
        child._ready_ = true;
        child.removeListener('message', readyListener);
        this._allocate(child.pid);
      }
    };
    const cleanUpChild = (err) => {
      if (this.workers.hasOwnProperty(child.pid)) {
        // Worker still exists, need to clean it up
        child.removeListener('message', readyListener);
        delete this.workers[child.pid];
        const index = this.idle.indexOf(child.pid);
        if (index > -1) {
          // Worker idle, can just remove from array
          this.idle.splice(index, 1);
        }
        else if (!child._ready_) {
          // Worker hadn't initialized yet, task not started
          throw 'Worker process could not start'  // TODO: is there a better way to handle this?
        }
        else {
          const listeners = child.listeners('message');
          if (listeners.length > 0) {
            listeners[0]({
              type: 'error',
              message: err,
            });
          }
          else if (child.killed) {
            console.log('Replacing worker %s after it completed %s tasks', child.pid, child._taskCount_);
            this._handleWorkerDone(child.pid);
          }
          else {
            console.error('No listeners for error', err);
            this._handleWorkerDone(child.pid);
          }
        }
      }
    };
    child.on('message', readyListener);
    child.on('exit', function(code, signal) {
      let msg;
      if (code !== null) {
        msg = 'Worker exited with code ' + code;
      }
      else {
        msg = 'Worker exited due to signal ' + signal;
      }
      cleanUpChild(msg);
    });
    child.on('error', function(err) {
      // TODO: make sure child process is actually dead?
      cleanUpChild(err);
    });

    this.workers[child.pid] = child;
    return child.pid;
  }

  _start (pid, task) {
    task
      .on('*', (type, message) => {
        if (type === 'end' || type === 'error') {
          this._handleWorkerDone(pid);
        }
        if (type === 'start') {
          this.emit(type, task);
        } else {
          this.emit(type, message, task);
        }
      })
      .run(this.workers[pid]);
  }

  _handleWorkerDone(pid) {
    if (this.workers.hasOwnProperty(pid)) {
      // no crash, handle next task or return to idle
      this._allocate(pid);
    }
    else if (this.tasks.length) {
      // worker crashed, check if we have any more work and start a new worker to do it if needed
      this._spawn();
    }
  }

  _allocate (pid) {
    const child = this.workers[pid];
    if (this.options.maxTasksPerWorker > 0 && child._taskCount_ >= this.options.maxTasksPerWorker) {
      child.kill();
    }
    else if (this.tasks.length) {
      this.emit('empty');
      child._taskCount_++;
      this._start(pid, this.tasks.pop());
    }
    else {
      this.idle.unshift(pid);
      if (Object.keys(this.workers).length === this.idle.length) {
        // Emit all work is drained.
        this.emit('drain');
      }
    }
  }

  run (command) {
    const task = new Task(command);
    // Make sure we return the task before starting it so the calling code has time to register any event handlers
    setTimeout(() => {
      if (this.idle.length) {
        this._start(this.idle.pop(), task);
      } else if (Object.keys(this.workers).length < this.options.workers) {
        this.tasks.unshift(task);
        this._spawn();
      } else {
        // Emit pool workers are saturated.
        this.emit('saturated');
        this.tasks.unshift(task);
      }
    });

    return task;
  }

  drain () {
    this.tasks = [];
    this.removeAllListeners();
    Object.keys(this.workers).forEach(key => {
      this.workers[key].kill();
    });
  }
}

module.exports = Pool;
