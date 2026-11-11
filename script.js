(() => {
  "use strict";

  const STORAGE_KEY = "studyspace-data-v1";
  const COLORS = ["#a38af8", "#84c8a9", "#e7aa7b", "#80a8ed", "#d18daf", "#d6c17e"];
  const MODES = {
    focus: { label: "TIME TO FOCUS", action: "Start focus", defaultMinutes: 25 },
    short: { label: "TAKE A BREATHER", action: "Start break", defaultMinutes: 5 },
    long: { label: "REST & RESET", action: "Start break", defaultMinutes: 15 }
  };
  let recoveredFocusCompletion = false;
  const defaults = () => ({
    subjects: [
      { id: "math", name: "Mathematics", color: COLORS[0] },
      { id: "science", name: "Science", color: COLORS[1] },
      { id: "writing", name: "Writing", color: COLORS[2] }
    ],
    tasks: [],
    durations: { focus: 25, short: 5, long: 15 },
    totalFocusMinutes: 0,
    focusDates: [],
    soundEnabled: true,
    timer: { mode: "focus", remaining: 1500, running: false, endsAt: null }
  });

  function loadState() {
    const base = defaults();
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!saved || typeof saved !== "object") return base;
      const subjects = Array.isArray(saved.subjects) ? saved.subjects.filter((s) => s && typeof s.id === "string" && typeof s.name === "string" && typeof s.color === "string") : base.subjects;
      const tasks = Array.isArray(saved.tasks) ? saved.tasks.filter((t) => t && typeof t.id === "string" && typeof t.title === "string").map((t) => ({
        id: t.id,
        title: t.title.slice(0, 100),
        subjectId: subjects.some((s) => s.id === t.subjectId) ? t.subjectId : (subjects[0]?.id || ""),
        priority: ["low", "medium", "high"].includes(t.priority) ? t.priority : "medium",
        completed: Boolean(t.completed),
        createdAt: Number(t.createdAt) || Date.now()
      })) : [];
      const duration = (key, max) => Number.isInteger(saved.durations?.[key]) && saved.durations[key] >= 1 && saved.durations[key] <= max ? saved.durations[key] : base.durations[key];
      const durations = { focus: duration("focus", 180), short: duration("short", 60), long: duration("long", 90) };
      const mode = Object.hasOwn(MODES, saved.timer?.mode) ? saved.timer.mode : "focus";
      const remaining = Number.isFinite(saved.timer?.remaining) && saved.timer.remaining >= 0 ? Math.floor(saved.timer.remaining) : base.timer.remaining;
      let timer = { mode, remaining, running: Boolean(saved.timer?.running), endsAt: Number.isFinite(saved.timer?.endsAt) ? saved.timer.endsAt : null };
      let totalFocusMinutes = Number.isFinite(saved.totalFocusMinutes) && saved.totalFocusMinutes >= 0 ? Math.floor(saved.totalFocusMinutes) : 0;
      const focusDates = Array.isArray(saved.focusDates) ? saved.focusDates.filter((date) => typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) : [];
      if (timer.running && timer.endsAt !== null) {
        timer.remaining = Math.max(0, Math.ceil((timer.endsAt - Date.now()) / 1000));
        if (timer.remaining === 0) {
          if (timer.mode === "focus") {
            totalFocusMinutes += durations.focus;
            const today = localDateKey();
            if (!focusDates.includes(today)) focusDates.push(today);
            recoveredFocusCompletion = true;
          }
          timer = { ...timer, running: false, endsAt: null };
        }
      } else if (timer.running) {
        timer.running = false;
      }
      return {
        subjects: subjects.length ? subjects : base.subjects,
        tasks,
        durations,
        totalFocusMinutes,
        focusDates,
        soundEnabled: saved.soundEnabled !== false,
        timer
      };
    } catch (error) {
      console.warn("Could not load saved studyspace data; starting fresh.", error);
      return base;
    }
  }

  let state = loadState();
  let activeFilter = "all";
  let toastTimeout;
  let audioContext;

  const $ = (selector) => document.querySelector(selector);
  const els = {
    today: $("#today-label"), subjectList: $("#subject-list"), taskList: $("#task-list"),
    emptyState: $("#empty-state"), emptyTitle: $("#empty-title"), emptyCopy: $("#empty-copy"),
    navCount: $("#nav-task-count"), headingCount: $("#heading-task-count"),
    streak: $("#streak-count"), totalMinutes: $("#total-minutes"), tasksDone: $("#tasks-done"),
    tasksTotal: $("#tasks-total"), tasksLeft: $("#tasks-left"), remaining: $("#remaining-label"),
    filterAllCount: $("#filter-all-count"), taskSubject: $("#task-subject"), taskForm: $("#task-form"),
    taskTitle: $("#task-title"), timerTime: $("#timer-time"), timerMode: $("#timer-mode-label"),
    timerHint: $("#timer-hint"), ring: $("#ring-progress"), startButton: $("#start-timer"),
    soundButton: $("#sound-toggle"), settingsDialog: $("#settings-dialog"),
    subjectDialog: $("#subject-dialog"), toast: $("#toast")
  };

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.error("Could not save studyspace data.", error);
      showToast("Your changes couldn’t be saved in this browser.");
    }
  }

  function localDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function renderHeader() {
    els.today.textContent = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(new Date());
  }

  function getSubject(id) {
    return state.subjects.find((subject) => subject.id === id);
  }

  function renderSubjects() {
    els.subjectList.replaceChildren();
    state.subjects.forEach((subject) => {
      const row = document.createElement("div");
      row.className = "subject-item";
      const dot = document.createElement("span");
      dot.className = "subject-dot";
      dot.style.backgroundColor = subject.color;
      const name = document.createElement("span");
      name.textContent = subject.name;
      const count = document.createElement("span");
      count.className = "subject-task-count";
      count.textContent = String(state.tasks.filter((task) => task.subjectId === subject.id && !task.completed).length);
      row.append(dot, name, count);
      els.subjectList.append(row);
    });

    const selected = els.taskSubject.value;
    els.taskSubject.replaceChildren();
    state.subjects.forEach((subject) => {
      const option = document.createElement("option");
      option.value = subject.id;
      option.textContent = subject.name;
      els.taskSubject.append(option);
    });
    if (state.subjects.some((subject) => subject.id === selected)) els.taskSubject.value = selected;
  }

  function makeTaskElement(task) {
    const row = document.createElement("div");
    row.className = `task-item${task.completed ? " completed" : ""}`;
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "task-checkbox";
    checkbox.checked = task.completed;
    checkbox.setAttribute("aria-label", `${task.completed ? "Mark incomplete" : "Complete"}: ${task.title}`);
    checkbox.addEventListener("change", () => {
      task.completed = checkbox.checked;
      save();
      render();
      if (task.completed) showToast("Nice work — one step closer.");
    });

    const main = document.createElement("div");
    main.className = "task-main";
    const title = document.createElement("span");
    title.className = "task-title";
    title.textContent = task.title;
    const meta = document.createElement("span");
    meta.className = "task-meta";
    const subjectLabel = document.createElement("span");
    subjectLabel.className = "task-subject";
    const subject = getSubject(task.subjectId);
    if (subject) {
      const dot = document.createElement("span");
      dot.className = "subject-dot";
      dot.style.backgroundColor = subject.color;
      subjectLabel.append(dot, document.createTextNode(subject.name));
    } else {
      subjectLabel.textContent = "General";
    }
    const priority = document.createElement("span");
    priority.className = `priority-tag priority-${task.priority}`;
    priority.textContent = `${task.priority[0].toUpperCase()}${task.priority.slice(1)} priority`;
    meta.append(subjectLabel, priority);
    main.append(title, meta);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "delete-task";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Delete ${task.title}`);
    remove.addEventListener("click", () => {
      state.tasks = state.tasks.filter((item) => item.id !== task.id);
      save();
      render();
      showToast("Task removed.");
    });
    row.append(checkbox, main, remove);
    return row;
  }

  function renderTasks() {
    const filtered = state.tasks.filter((task) => activeFilter === "all" || (activeFilter === "active" ? !task.completed : task.completed));
    els.taskList.replaceChildren(...filtered.map(makeTaskElement));
    const empty = filtered.length === 0;
    els.emptyState.hidden = !empty;
    els.taskList.hidden = empty;
    if (empty) {
      els.emptyTitle.textContent = activeFilter === "completed" ? "Nothing completed yet." : activeFilter === "active" && state.tasks.length ? "All caught up!" : "A fresh start.";
      els.emptyCopy.textContent = activeFilter === "completed" ? "Your finished tasks will show up here." : activeFilter === "active" && state.tasks.length ? "You’ve finished everything on your list." : "Add your first task and make it happen.";
      $("#empty-add-task").hidden = activeFilter === "completed" || (activeFilter === "active" && state.tasks.length > 0);
    }
    const openCount = state.tasks.filter((task) => !task.completed).length;
    const completedCount = state.tasks.length - openCount;
    els.navCount.textContent = String(openCount);
    els.headingCount.textContent = String(state.tasks.length);
    els.filterAllCount.textContent = String(state.tasks.length);
    els.tasksDone.textContent = String(completedCount);
    els.tasksTotal.textContent = String(state.tasks.length);
    els.tasksLeft.textContent = openCount ? `${openCount} task${openCount === 1 ? "" : "s"} to go` : "Ready when you are";
    els.remaining.textContent = `${openCount} task${openCount === 1 ? "" : "s"} left`;
  }

  function getStreak() {
    const dates = new Set(state.focusDates);
    const today = new Date();
    let cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (!dates.has(localDateKey(cursor))) cursor.setDate(cursor.getDate() - 1);
    let streak = 0;
    while (dates.has(localDateKey(cursor))) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
  }

  function renderStats() {
    els.streak.textContent = String(getStreak());
    els.totalMinutes.textContent = String(state.totalFocusMinutes);
  }

  function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  }

  function renderTimer() {
    const mode = MODES[state.timer.mode];
    const duration = state.durations[state.timer.mode] * 60;
    els.timerTime.textContent = formatTime(state.timer.remaining);
    els.timerMode.textContent = mode.label;
    els.startButton.querySelector("span:last-child").textContent = state.timer.running ? "Pause timer" : mode.action;
    els.startButton.querySelector(".start-icon").textContent = state.timer.running ? "Ⅱ" : "▶";
    els.timerHint.innerHTML = `<span class="hint-dot"></span>${state.timer.running ? "Stay in your flow" : "Ready when you are"}`;
    els.timerHint.classList.toggle("timer-running", state.timer.running);
    const progress = duration > 0 ? state.timer.remaining / duration : 0;
    els.ring.style.strokeDashoffset = String(684.3 * (1 - Math.min(1, progress)));
    document.querySelectorAll(".timer-tab").forEach((tab) => {
      const selected = tab.dataset.mode === state.timer.mode;
      tab.classList.toggle("selected", selected);
      tab.setAttribute("aria-selected", String(selected));
    });
    els.soundButton.classList.toggle("muted", !state.soundEnabled);
    els.soundButton.setAttribute("aria-label", state.soundEnabled ? "Mute timer sound" : "Enable timer sound");
  }

  function render() {
    renderSubjects();
    renderTasks();
    renderStats();
    renderTimer();
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add("visible");
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => els.toast.classList.remove("visible"), 2500);
  }

  function selectMode(mode) {
    if (!Object.hasOwn(MODES, mode)) return;
    state.timer = { mode, remaining: state.durations[mode] * 60, running: false, endsAt: null };
    save();
    renderTimer();
  }

  function playAlert() {
    if (!state.soundEnabled) return;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      audioContext ||= new AudioContextClass();
      if (audioContext.state === "suspended") audioContext.resume();
      [0, 0.22, 0.44].forEach((offset, index) => {
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = index === 1 ? 740 : 660;
        gain.gain.setValueAtTime(0.0001, audioContext.currentTime + offset);
        gain.gain.exponentialRampToValueAtTime(0.12, audioContext.currentTime + offset + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + offset + 0.18);
        oscillator.connect(gain);
        gain.connect(audioContext.destination);
        oscillator.start(audioContext.currentTime + offset);
        oscillator.stop(audioContext.currentTime + offset + 0.2);
      });
    } catch (error) {
      console.warn("Timer sound could not be played.", error);
    }
  }

  function completeTimer() {
    const completedMode = state.timer.mode;
    if (completedMode === "focus") {
      state.totalFocusMinutes += state.durations.focus;
      const today = localDateKey();
      if (!state.focusDates.includes(today)) state.focusDates.push(today);
    }
    state.timer.running = false;
    state.timer.endsAt = null;
    state.timer.remaining = 0;
    save();
    render();
    playAlert();
    showToast(completedMode === "focus" ? "Focus session complete. Take a well-earned break!" : "Break complete. Ready to focus again?");
  }

  function syncTimer() {
    if (!state.timer.running || !state.timer.endsAt) return;
    state.timer.remaining = Math.max(0, Math.ceil((state.timer.endsAt - Date.now()) / 1000));
    if (state.timer.remaining === 0) completeTimer();
    else renderTimer();
  }

  function startOrPauseTimer() {
    if (state.timer.running) {
      syncTimer();
      if (!state.timer.running) return;
      state.timer.running = false;
      state.timer.endsAt = null;
    } else {
      if (state.timer.remaining <= 0) state.timer.remaining = state.durations[state.timer.mode] * 60;
      state.timer.running = true;
      state.timer.endsAt = Date.now() + state.timer.remaining * 1000;
    }
    save();
    renderTimer();
  }

  function resetTimer() {
    state.timer = { mode: state.timer.mode, remaining: state.durations[state.timer.mode] * 60, running: false, endsAt: null };
    save();
    renderTimer();
  }

  function skipTimer() {
    const next = state.timer.mode === "focus" ? "short" : "focus";
    selectMode(next);
  }

  function openTaskForm() {
    if (!state.subjects.length) {
      showToast("Add a subject before creating a task.");
      return;
    }
    els.taskForm.hidden = false;
    els.taskTitle.focus();
  }

  function addTask(event) {
    event.preventDefault();
    const title = els.taskTitle.value.trim();
    if (!title || !state.subjects.length) return;
    state.tasks.unshift({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title,
      subjectId: els.taskSubject.value,
      priority: $("#task-priority").value,
      completed: false,
      createdAt: Date.now()
    });
    els.taskForm.reset();
    els.taskForm.hidden = true;
    activeFilter = "all";
    document.querySelectorAll(".filter-button").forEach((button) => button.classList.toggle("active", button.dataset.filter === activeFilter));
    save();
    render();
    showToast("Task added to your list.");
  }

  function openTimerSettings() {
    $("#focus-duration").value = String(state.durations.focus);
    $("#short-duration").value = String(state.durations.short);
    $("#long-duration").value = String(state.durations.long);
    els.settingsDialog.showModal();
  }

  function saveTimerSettings(event) {
    if (event.submitter?.id !== "save-settings") return;
    event.preventDefault();
    const focus = Number($("#focus-duration").value);
    const short = Number($("#short-duration").value);
    const long = Number($("#long-duration").value);
    if (!Number.isInteger(focus) || focus < 1 || focus > 180 || !Number.isInteger(short) || short < 1 || short > 60 || !Number.isInteger(long) || long < 1 || long > 90) {
      showToast("Enter a valid duration for each timer.");
      return;
    }
    state.durations = { focus, short, long };
    state.timer = { mode: state.timer.mode, remaining: state.durations[state.timer.mode] * 60, running: false, endsAt: null };
    save();
    renderTimer();
    els.settingsDialog.close();
    showToast("Timer durations updated.");
  }

  function addSubject(event) {
    if (event.submitter?.id !== "save-subject") return;
    event.preventDefault();
    const name = $("#subject-name").value.trim();
    if (!name) return;
    if (state.subjects.some((subject) => subject.name.toLowerCase() === name.toLowerCase())) {
      showToast("That subject already exists.");
      return;
    }
    const color = COLORS[state.subjects.length % COLORS.length];
    const id = `subject-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    state.subjects.push({ id, name, color });
    save();
    render();
    els.taskSubject.value = id;
    $("#subject-form").reset();
    els.subjectDialog.close();
    showToast(`${name} added to your subjects.`);
  }

  document.querySelectorAll(".timer-tab").forEach((tab) => tab.addEventListener("click", () => selectMode(tab.dataset.mode)));
  document.querySelectorAll(".filter-button").forEach((button) => button.addEventListener("click", () => {
    activeFilter = button.dataset.filter;
    document.querySelectorAll(".filter-button").forEach((item) => item.classList.toggle("active", item === button));
    renderTasks();
  }));
  $("#start-timer").addEventListener("click", startOrPauseTimer);
  $("#reset-timer").addEventListener("click", resetTimer);
  $("#skip-timer").addEventListener("click", skipTimer);
  $("#timer-settings").addEventListener("click", openTimerSettings);
  $("#settings-form").addEventListener("submit", saveTimerSettings);
  $("#open-task-form").addEventListener("click", openTaskForm);
  $("#empty-add-task").addEventListener("click", openTaskForm);
  $("#cancel-task-form").addEventListener("click", () => { els.taskForm.reset(); els.taskForm.hidden = true; });
  els.taskForm.addEventListener("submit", addTask);
  $("#add-subject-button").addEventListener("click", () => {
    $("#subject-name").value = "";
    els.subjectDialog.showModal();
    $("#subject-name").focus();
  });
  $("#subject-form").addEventListener("submit", addSubject);
  els.soundButton.addEventListener("click", () => {
    state.soundEnabled = !state.soundEnabled;
    save();
    renderTimer();
    showToast(state.soundEnabled ? "Timer sound enabled." : "Timer sound muted.");
  });
  document.querySelectorAll(".settings-dialog").forEach((dialog) => dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  }));
  document.querySelectorAll(".main-nav .nav-link").forEach((link) => link.addEventListener("click", () => {
    document.querySelectorAll(".main-nav .nav-link").forEach((item) => {
      item.classList.toggle("active", item === link);
      if (item === link) item.setAttribute("aria-current", "page");
      else item.removeAttribute("aria-current");
    });
  }));

  renderHeader();
  render();
  if (recoveredFocusCompletion) {
    save();
    showToast("Your focus session completed while you were away.");
  }
  setInterval(syncTimer, 250);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) syncTimer(); });
})();
