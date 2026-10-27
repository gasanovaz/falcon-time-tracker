const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_EMPLOYEES = [
  { id: 'emp-1', name: 'Алиса Соколова', role: 'AI Automation Engineer', createdAt: '2026-10-01T09:00:00.000Z' },
  { id: 'emp-2', name: 'Тимур Белов', role: 'Full-Stack Developer', createdAt: '2026-10-01T09:05:00.000Z' },
  { id: 'emp-3', name: 'Мария Крылова', role: 'Product Designer', createdAt: '2026-10-01T09:10:00.000Z' }
];

const DEFAULT_ENTRIES = [
  {
    id: 'entry-101',
    employeeId: 'emp-1',
    task: 'Интеграция LLM-агента классификации заявок через API',
    startTime: '2026-10-26T09:00:00.000Z',
    endTime: '2026-10-26T11:30:00.000Z',
    durationSeconds: 9000
  },
  {
    id: 'entry-102',
    employeeId: 'emp-2',
    task: 'Разработка дашборда аналитики рабочего времени и экспорт отчётов',
    startTime: '2026-10-26T12:00:00.000Z',
    endTime: '2026-10-26T14:15:00.000Z',
    durationSeconds: 8100
  }
];

class TimeTrackerStore {
  constructor(filePath, { seedIfEmpty = true } = {}) {
    this.filePath = filePath || path.join(__dirname, '..', 'data', 'store.json');
    this.seedIfEmpty = seedIfEmpty;
    this.state = { employees: [], entries: [] };
    this._load();
  }

  _load() {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (fs.existsSync(this.filePath)) {
      try {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(raw);
        this.state = {
          employees: Array.isArray(parsed.employees) ? parsed.employees : [],
          entries: Array.isArray(parsed.entries) ? parsed.entries : []
        };
        return;
      } catch (err) {
        // Если файл повреждён, инициализируем чистое состояние
      }
    }
    if (this.seedIfEmpty) {
      this.state = {
        employees: structuredClone(DEFAULT_EMPLOYEES),
        entries: structuredClone(DEFAULT_ENTRIES)
      };
    } else {
      this.state = { employees: [], entries: [] };
    }
    this._save();
  }

  _save() {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tmpPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(this.state, null, 2), 'utf8');
    fs.renameSync(tmpPath, this.filePath);
  }

  getEmployees() {
    return this.state.employees.map((emp) => {
      const activeEntry = this.state.entries.find(
        (e) => e.employeeId === emp.id && e.endTime === null
      ) || null;
      return { ...emp, activeTimer: activeEntry };
    });
  }

  addEmployee({ name, role = 'Специалист' }) {
    const cleanName = typeof name === 'string' ? name.trim() : '';
    const cleanRole = typeof role === 'string' && role.trim() ? role.trim() : 'Специалист';
    if (!cleanName) {
      const err = new Error('Имя сотрудника обязательно');
      err.statusCode = 400;
      throw err;
    }
    const employee = {
      id: `emp-${crypto.randomUUID().slice(0, 8)}`,
      name: cleanName,
      role: cleanRole,
      createdAt: new Date().toISOString()
    };
    this.state.employees.push(employee);
    this._save();
    return employee;
  }

  startTimer({ employeeId, task, now = new Date() }) {
    const employee = this.state.employees.find((e) => e.id === employeeId);
    if (!employee) {
      const err = new Error('Сотрудник не найден');
      err.statusCode = 404;
      throw err;
    }
    const cleanTask = typeof task === 'string' ? task.trim() : '';
    if (!cleanTask) {
      const err = new Error('Описание задачи обязательно для запуска таймера');
      err.statusCode = 400;
      throw err;
    }
    const existingActive = this.state.entries.find(
      (e) => e.employeeId === employeeId && e.endTime === null
    );
    if (existingActive) {
      const err = new Error(
        `У сотрудника "${employee.name}" уже запущен активный таймер по задаче "${existingActive.task}". Сначала остановите текущий таймер.`
      );
      err.statusCode = 409;
      err.code = 'TIMER_ALREADY_RUNNING';
      throw err;
    }

    const startIso = (now instanceof Date ? now : new Date(now)).toISOString();
    const entry = {
      id: `entry-${crypto.randomUUID().slice(0, 8)}`,
      employeeId,
      task: cleanTask,
      startTime: startIso,
      endTime: null,
      durationSeconds: 0
    };
    this.state.entries.push(entry);
    this._save();
    return entry;
  }

  stopTimer({ employeeId, entryId, now = new Date() }) {
    const activeEntry = this.state.entries.find((e) => {
      if (e.endTime !== null) return false;
      if (entryId && e.id === entryId) return true;
      if (employeeId && e.employeeId === employeeId) return true;
      return false;
    });

    if (!activeEntry) {
      const err = new Error('Активный таймер не найден');
      err.statusCode = 404;
      err.code = 'NO_ACTIVE_TIMER';
      throw err;
    }

    const endMs = (now instanceof Date ? now : new Date(now)).getTime();
    const startMs = new Date(activeEntry.startTime).getTime();
    const rawDiffSeconds = Math.round((endMs - startMs) / 1000);
    activeEntry.endTime = new Date(Math.max(endMs, startMs)).toISOString();
    activeEntry.durationSeconds = Math.max(1, rawDiffSeconds);
    this._save();
    return activeEntry;
  }

  getReport({ from, to, employeeId, now = new Date() } = {}) {
    let fromMs = null;
    let toMs = null;

    if (from) {
      const d = from.length === 10 ? new Date(`${from}T00:00:00.000Z`) : new Date(from);
      if (!Number.isNaN(d.getTime())) fromMs = d.getTime();
    }
    if (to) {
      const d = to.length === 10 ? new Date(`${to}T23:59:59.999Z`) : new Date(to);
      if (!Number.isNaN(d.getTime())) toMs = d.getTime();
    }

    const nowMs = (now instanceof Date ? now : new Date(now)).getTime();
    const employeeMap = new Map(this.state.employees.map((e) => [e.id, e]));

    const filteredEntries = this.state.entries
      .filter((entry) => {
        if (employeeId && entry.employeeId !== employeeId) return false;
        const startMs = new Date(entry.startTime).getTime();
        if (fromMs !== null && startMs < fromMs) return false;
        if (toMs !== null && startMs > toMs) return false;
        return true;
      })
      .map((entry) => {
        const emp = employeeMap.get(entry.employeeId);
        const isRunning = entry.endTime === null;
        const liveSeconds = isRunning
          ? Math.max(1, Math.round((nowMs - new Date(entry.startTime).getTime()) / 1000))
          : entry.durationSeconds;
        return {
          ...entry,
          employeeName: emp ? emp.name : 'Неизвестный сотрудник',
          employeeRole: emp ? emp.role : '',
          isRunning,
          effectiveDurationSeconds: liveSeconds
        };
      })
      .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());

    const targetEmployees = employeeId
      ? this.state.employees.filter((e) => e.id === employeeId)
      : this.state.employees;

    const summaryByEmployee = targetEmployees.map((emp) => {
      const empEntries = filteredEntries.filter((e) => e.employeeId === emp.id);
      const totalSeconds = empEntries.reduce((acc, e) => acc + e.effectiveDurationSeconds, 0);
      return {
        employeeId: emp.id,
        employeeName: emp.name,
        employeeRole: emp.role,
        entriesCount: empEntries.length,
        totalSeconds,
        hasActiveTimer: empEntries.some((e) => e.isRunning)
      };
    });

    const totalSecondsAll = filteredEntries.reduce((acc, e) => acc + e.effectiveDurationSeconds, 0);

    return {
      period: { from: from || null, to: to || null, employeeId: employeeId || null },
      isEmpty: filteredEntries.length === 0,
      totalEntries: filteredEntries.length,
      totalSeconds: totalSecondsAll,
      summaryByEmployee,
      entries: filteredEntries
    };
  }
}

module.exports = { TimeTrackerStore };
