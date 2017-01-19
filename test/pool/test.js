'use strict';

// system
const os = require('os');

// libraries
require('chai').should();
const sinon = require('sinon');

// modules
const Pool = require('../../lib/pool');

describe('Pool', () => {

  let pool, path;

  beforeEach(() => {
    path = `${__dirname}/worker`;
  });

  afterEach(() => {
    pool.drain();
  });

  describe('constructor', () => {

    beforeEach(() => {
      sinon.stub(os, 'cpus').returns([{}, {}, {}, {}, {}]);
    });

    afterEach(() => {
      os.cpus.restore();
    });

    it('should create a worker with the given path', () => {

      pool = new Pool(path);

      Object.keys(pool.workers).forEach(key => {
        pool.workers[key].spawnargs[1].should.equal(path);
      });
    });

    it('should default to the number of workers returned by os.cpus()', () => {
      os.cpus.should.be.calledOnce;
      Object.keys(new Pool(path).workers).length.should.equal(5);
    });

    describe('options', () => {
      it('should use the number of workers passed in if specified', () => {
        const num = 7;

        Object.keys(new Pool(path, {
          workers: num
        }).workers).length.should.equal(num);
      });

      it('should pass arguments to the workers', () => {
        const argument = '--test';
        pool = new Pool(path, {
          arguments: [argument]
        });

        Object.keys(pool.workers).forEach(key => {
          pool.workers[key].spawnargs[2].should.equal(argument);
        });
      });
    });
  });

  describe('.run', () => {

    it('should run the task immediately if there are idle workers', () => {
      pool = new Pool(path, {
        workers: 1
      });

      const task = pool.run('wait');
      task.state.should.equal('running');
    });

    describe('queue', () => {

      it('should queue the task if every worker is busy', () => {
        pool = new Pool(path, {
          workers: 1
        });

        const task1 = pool.run('wait'),
              task2 = pool.run('test');

        task2.state.should.equal('queued');
        pool.tasks[0].should.equal(task2);
      });

      it('should run a queued task as soon as a worker becomes idle', done => {
        pool = new Pool(path, {
          workers: 1
        });

        const task1 = pool.run('wait'),
              task2 = pool.run('wait').on('start', done);

        task1._send('go');
      });
    });
  });

  describe('.on', () => {

    beforeEach(() => {
      pool = new Pool(path, {
        workers: 1
      });
    });

    describe('start', () => {

      it('should proxy task "start" events', done => {
        const task1 = pool.run('wait'),
              task2 = pool.run('wait');

        pool.on('start', _task => {
          _task.should.equal(task2);
          done();
        });

        task1._send('go');
      });
    });

    describe('end', () => {

      let task;

      it('should proxy task "end" events', done => {
        let task;

        pool.on('end', (message, _task) => {
          _task.should.equal(task);
          done();
        });

        task = pool.run('');
      });
    });

    describe('error', () => {

      it('should proxy task "error" events', done => {
        let task;

        pool.on('error', (err, _task) => {
          _task.should.equal(task);
          done();
        });

        task = pool.run('error');
      });
    });
  });

  describe('.available()', () => {

    it('should return the number of idle workers', done => {
      pool = new Pool(path, {
        workers: 1
      });

      pool.available().should.equal(1);

      const task = pool.run('wait').on('end', () => {
        pool.available().should.equal(1);
        done();
      });

      pool.available().should.equal(0);
      task._send('go');
    });
  });

  describe('.total()', () => {

    it('should return the total number workers', done => {
      pool = new Pool(path, {
        workers: 1
      });

      pool.total().should.equal(1);

      const task = pool.run('wait').on('end', done);

      pool.total().should.equal(1);
      task._send('go');
    });
  });

  describe('.drain()', () => {

    it('should kill all workers', done => {

      pool = new Pool(path, {
        workers: 1
      });

      pool.workers[pool.idle[0]].on('exit', done);

      pool.drain();
    });

    it('should remove all tasks from the queue', () => {
      pool = new Pool(path, {
        workers: 0
      });

      pool.run('');
      pool.drain();
      pool.tasks.length.should.equal(0);
    });
  });
});
