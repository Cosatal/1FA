// Central scheduler of the bot's recurring tasks (end of temp bans, alerts, game servers, saving…).
// Each task is started again only once the previous run is over (setTimeout chained, not setInterval): a slow run
// (a game server that doesn't answer, a slow RSS feed) can't overlap the next one. An error is logged, the task goes on.
// The timers don't keep the process alive on their own (unref): the bot stops normally.
const tasks = new Map(); // name → { every, timer, running, runs, lastRun, lastDuration, lastError }

// every: milliseconds between the end of a run and the start of the next · first: delay before the first run
function every(name, ms, run, { first = ms } = {}) {
  if (tasks.has(name)) throw new Error(`Task "${name}" already scheduled`);
  const task = { every: ms, timer: null, running: false, runs: 0, lastRun: 0, lastDuration: 0, lastError: null };
  tasks.set(name, task);
  const loop = async () => {
    task.running = true;
    const start = Date.now();
    try {
      await run();
      task.lastError = null;
    } catch (error) {
      task.lastError = error.message;
      console.error(`Task ${name}:`, error.message);
    }
    task.running = false;
    task.runs++;
    task.lastRun = start;
    task.lastDuration = Date.now() - start;
    if (tasks.get(name) === task) task.timer = setTimeout(loop, ms).unref();
  };
  task.timer = setTimeout(loop, first).unref();
}

// State of every task (useful to see what is slow)
const taskStatus = () => Object.fromEntries([...tasks].map(([name, { every: ms, running, runs, lastRun, lastDuration, lastError }]) => [name, { every: ms, running, runs, lastRun, lastDuration, lastError }]));

function stopAll() {
  for (const task of tasks.values()) clearTimeout(task.timer);
  tasks.clear();
}

module.exports = { every, taskStatus, stopAll };
