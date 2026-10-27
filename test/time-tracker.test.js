const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { TimeTrackerStore } = require('../src/store');

function createTempStorePath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'falcon-tt-'));
  return path.join(dir, 'store.json');
}

test('1. Пустой отчёт (когда нет ни сотрудников, ни записей за выбранный период)', () => {
  const storePath = createTempStorePath();
  const store = new TimeTrackerStore(storePath, { seedIfEmpty: false });

  const emptyReport = store.getReport({ from: '2026-10-01', to: '2026-10-31' });
  assert.equal(emptyReport.isEmpty, true);
  assert.equal(emptyReport.totalEntries, 0);
  assert.equal(emptyReport.totalSeconds, 0);
  assert.deepEqual(emptyReport.entries, []);
  assert.deepEqual(emptyReport.summaryByEmployee, []);
});

test('2. Добавление сотрудников и валидация пустого имени', () => {
  const storePath = createTempStorePath();
  const store = new TimeTrackerStore(storePath, { seedIfEmpty: false });

  const emp = store.addEmployee({ name: 'Игорь Смирнов', role: 'Backend Engineer' });
  assert.equal(emp.name, 'Игорь Смирнов');
  assert.equal(emp.role, 'Backend Engineer');
  assert.equal(store.getEmployees().length, 1);

  assert.throws(
    () => store.addEmployee({ name: '   ' }),
    (err) => err.statusCode === 400
  );
});

test('3. Запуск, остановка таймера и защита от повторного запуска (TIMER_ALREADY_RUNNING)', () => {
  const storePath = createTempStorePath();
  const store = new TimeTrackerStore(storePath, { seedIfEmpty: false });
  const emp = store.addEmployee({ name: 'Елена Волкова', role: 'AI Engineer' });

  const startTime = new Date('2026-10-27T10:00:00.000Z');
  const started = store.startTimer({
    employeeId: emp.id,
    task: 'Настройка промпта для классификатора лидов',
    now: startTime
  });
  assert.equal(started.endTime, null);

  // Попытка повторно запустить второй таймер тому же сотруднику без остановки первого
  assert.throws(
    () =>
      store.startTimer({
        employeeId: emp.id,
        task: 'Вторая параллельная задача',
        now: new Date('2026-10-27T10:05:00.000Z')
      }),
    (err) => err.statusCode === 409 && err.code === 'TIMER_ALREADY_RUNNING'
  );

  // Остановка первого таймера через 45 минут (2700 секунд)
  const stopped = store.stopTimer({
    employeeId: emp.id,
    now: new Date('2026-10-27T10:45:00.000Z')
  });
  assert.equal(stopped.durationSeconds, 2700);
  assert.equal(stopped.endTime, '2026-10-27T10:45:00.000Z');

  // Повторный запуск нового таймера ПОСЛЕ остановки предыдущего должен работать штатно
  const secondRun = store.startTimer({
    employeeId: emp.id,
    task: 'Ревью сгенерированного кода и написание тестов',
    now: new Date('2026-10-27T11:00:00.000Z')
  });
  assert.equal(secondRun.endTime, null);
  store.stopTimer({
    employeeId: emp.id,
    now: new Date('2026-10-27T11:30:00.000Z')
  });

  const report = store.getReport({ employeeId: emp.id });
  assert.equal(report.totalEntries, 2);
  assert.equal(report.totalSeconds, 2700 + 1800);
});

test('4. Просмотр записей и общего времени каждого сотрудника за выбранный период', () => {
  const storePath = createTempStorePath();
  const store = new TimeTrackerStore(storePath, { seedIfEmpty: false });
  const emp1 = store.addEmployee({ name: 'Анна Морозова', role: 'Frontend' });
  const emp2 = store.addEmployee({ name: 'Павел Лебедев', role: 'DevOps' });

  // Запись за 20 октября (вне октябрьского спринта 25-27 октября)
  store.startTimer({ employeeId: emp1.id, task: 'Старая задача', now: '2026-10-20T09:00:00.000Z' });
  store.stopTimer({ employeeId: emp1.id, now: '2026-10-20T10:00:00.000Z' });

  // Записи внутри периода 25–27 октября
  store.startTimer({ employeeId: emp1.id, task: 'Верстка таблицы отчётов', now: '2026-10-25T10:00:00.000Z' });
  store.stopTimer({ employeeId: emp1.id, now: '2026-10-25T12:00:00.000Z' }); // 7200 сек

  store.startTimer({ employeeId: emp2.id, task: 'Деплой контейнера', now: '2026-10-27T18:00:00.000Z' });
  store.stopTimer({ employeeId: emp2.id, now: '2026-10-27T19:00:00.000Z' }); // 3600 сек

  const filtered = store.getReport({ from: '2026-10-25', to: '2026-10-27' });
  assert.equal(filtered.isEmpty, false);
  assert.equal(filtered.totalEntries, 2);
  assert.equal(filtered.totalSeconds, 10800);

  const s1 = filtered.summaryByEmployee.find((s) => s.employeeId === emp1.id);
  const s2 = filtered.summaryByEmployee.find((s) => s.employeeId === emp2.id);
  assert.equal(s1.totalSeconds, 7200);
  assert.equal(s2.totalSeconds, 3600);
});

test('5. Сохранение данных после перезапуска приложения', () => {
  const storePath = createTempStorePath();
  const storeBeforeRestart = new TimeTrackerStore(storePath, { seedIfEmpty: false });
  const emp = storeBeforeRestart.addEmployee({ name: 'Максим Новиков', role: 'Architect' });

  storeBeforeRestart.startTimer({
    employeeId: emp.id,
    task: 'Проектирование схемы хранения',
    now: '2026-10-27T08:00:00.000Z'
  });
  storeBeforeRestart.stopTimer({
    employeeId: emp.id,
    now: '2026-10-27T09:30:00.000Z'
  });

  // Имитируем перезапуск сервера — создаём новый экземпляр TimeTrackerStore на том же файле
  const storeAfterRestart = new TimeTrackerStore(storePath, { seedIfEmpty: false });
  const employees = storeAfterRestart.getEmployees();
  assert.equal(employees.length, 1);
  assert.equal(employees[0].name, 'Максим Новиков');

  const report = storeAfterRestart.getReport();
  assert.equal(report.totalEntries, 1);
  assert.equal(report.totalSeconds, 5400);
  assert.equal(report.entries[0].task, 'Проектирование схемы хранения');
});
