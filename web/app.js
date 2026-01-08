const loginSection = document.getElementById('loginSection');
const boardSection = document.getElementById('boardSection');
const loginForm = document.getElementById('loginForm');
const loginError = document.getElementById('loginError');
const logoutButton = document.getElementById('logoutButton');
const refreshButton = document.getElementById('refreshButton');
const newTaskButton = document.getElementById('newTaskButton');
const todoColumn = document.getElementById('todoColumn');
const doingColumn = document.getElementById('doingColumn');
const doneColumn = document.getElementById('doneColumn');
const modal = document.getElementById('modal');
const taskForm = document.getElementById('taskForm');
const cancelTask = document.getElementById('cancelTask');
const body = document.body;
const searchInput = document.getElementById('searchInput');
const priorityFilter = document.getElementById('priorityFilter');
const tagFilter = document.getElementById('tagFilter');
const dueFilter = document.getElementById('dueFilter');
const statTotal = document.getElementById('statTotal');
const statDoing = document.getElementById('statDoing');
const statDone = document.getElementById('statDone');

let boardState = { todo: [], doing: [], done: [] };
let activeTaskId = null;

const tokenKey = 'kanban-token';

function getToken() {
  return localStorage.getItem(tokenKey);
}

function setToken(token) {
  if (token) {
    localStorage.setItem(tokenKey, token);
  } else {
    localStorage.removeItem(tokenKey);
  }
}

function showLogin() {
  loginSection.hidden = false;
  boardSection.hidden = true;
  logoutButton.hidden = true;
  body.classList.add('login-active');
}

function showBoard() {
  loginSection.hidden = true;
  boardSection.hidden = false;
  logoutButton.hidden = false;
  body.classList.remove('login-active');
}

async function login(username, password) {
  const response = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Falha no login');
  }

  return response.json();
}

async function logout() {
  await fetch('/api/logout', {
    method: 'POST',
    headers: authHeaders()
  });
  setToken(null);
  showLogin();
}

function authHeaders() {
  return {
    Authorization: `Bearer ${getToken()}`
  };
}

async function fetchBoard() {
  const response = await fetch('/api/board', {
    headers: authHeaders()
  });
  if (!response.ok) {
    throw new Error('Falha ao carregar o quadro');
  }
  return response.json();
}

async function saveBoard(board) {
  const response = await fetch('/api/board', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders()
    },
    body: JSON.stringify(board)
  });
  if (!response.ok) {
    throw new Error('Falha ao salvar alterações');
  }
  return response.json();
}

function renderBoard() {
  todoColumn.innerHTML = '';
  doingColumn.innerHTML = '';
  doneColumn.innerHTML = '';

  const renderColumn = (columnEl, tasks, columnName) => {
    tasks.forEach((task, index) => {
      const card = document.createElement('div');
      card.className = 'card task-card';
      const tagList = task.tags?.length
        ? task.tags.map((tag) => `<span class="tag">${tag}</span>`).join('')
        : '<span class="tag muted">Sem tags</span>';
      const priorityClass = `priority-${task.priority || 'media'}`;
      const dueLabel = formatDueDate(task.dueDate);
      card.innerHTML = `
        <div class="task-header">
          <h4>${task.title}</h4>
          <span class="pill">#${index + 1}</span>
        </div>
        <p>${task.description || 'Sem descrição.'}</p>
        <div class="task-meta">
          <span class="priority ${priorityClass}">${labelPriority(task.priority)}</span>
          <span class="due-date">${dueLabel}</span>
        </div>
        <div class="task-tags">${tagList}</div>
        <div class="task-actions"></div>
      `;

      const actions = card.querySelector('.task-actions');

      if (columnName !== 'todo') {
        const backButton = document.createElement('button');
        backButton.className = 'ghost-button';
        backButton.textContent = 'Voltar';
        backButton.addEventListener('click', () => moveTask(columnName, task.id, -1));
        actions.appendChild(backButton);
      }

      if (columnName !== 'done') {
        const nextButton = document.createElement('button');
        nextButton.className = 'primary-button';
        nextButton.textContent = 'Avançar';
        nextButton.addEventListener('click', () => moveTask(columnName, task.id, 1));
        actions.appendChild(nextButton);
      }

      const editButton = document.createElement('button');
      editButton.className = 'ghost-button';
      editButton.textContent = 'Editar';
      editButton.addEventListener('click', () => openModal(task));
      actions.appendChild(editButton);

      const deleteButton = document.createElement('button');
      deleteButton.className = 'danger-button';
      deleteButton.textContent = 'Excluir';
      deleteButton.addEventListener('click', () => deleteTask(columnName, task.id));
      actions.appendChild(deleteButton);

      columnEl.appendChild(card);
    });
  };

  const filtered = applyFilters();
  renderColumn(todoColumn, filtered.todo, 'todo');
  renderColumn(doingColumn, filtered.doing, 'doing');
  renderColumn(doneColumn, filtered.done, 'done');
  updateStats();
}

function moveTask(column, taskId, direction) {
  const columns = ['todo', 'doing', 'done'];
  const currentIndex = columns.indexOf(column);
  const nextIndex = currentIndex + direction;
  if (nextIndex < 0 || nextIndex >= columns.length) return;

  const currentList = boardState[column];
  const taskIndex = currentList.findIndex((task) => task.id === taskId);
  if (taskIndex === -1) return;

  const [task] = currentList.splice(taskIndex, 1);
  boardState[columns[nextIndex]].unshift(task);

  persistBoard();
}

function deleteTask(column, taskId) {
  const currentList = boardState[column];
  const taskIndex = currentList.findIndex((task) => task.id === taskId);
  if (taskIndex === -1) return;
  currentList.splice(taskIndex, 1);
  persistBoard();
}

async function persistBoard() {
  try {
    boardState = await saveBoard(boardState);
    renderBoard();
  } catch (error) {
    alert(error.message || 'Erro ao salvar');
  }
}

function openModal(task = null) {
  modal.hidden = false;
  taskForm.reset();
  activeTaskId = null;
  if (task) {
    activeTaskId = task.id;
    taskForm.title.value = task.title;
    taskForm.description.value = task.description || '';
    taskForm.priority.value = task.priority || 'media';
    taskForm.dueDate.value = task.dueDate || '';
    taskForm.tags.value = task.tags?.join(', ') || '';
  }
}

function closeModal() {
  modal.hidden = true;
}

function generateId() {
  return crypto.randomUUID();
}

function normalizeTags(rawTags) {
  if (!rawTags) return [];
  return rawTags
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function labelPriority(priority) {
  switch (priority) {
    case 'alta':
      return 'Alta';
    case 'baixa':
      return 'Baixa';
    default:
      return 'Média';
  }
}

function formatDueDate(dateValue) {
  if (!dateValue) return 'Sem prazo';
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return 'Sem prazo';
  return date.toLocaleDateString('pt-BR');
}

function applyFilters() {
  const query = searchInput.value.trim().toLowerCase();
  const priorityValue = priorityFilter.value;
  const tagValue = tagFilter.value.trim().toLowerCase();
  const dueValue = dueFilter.value;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const weekAhead = new Date(now);
  weekAhead.setDate(weekAhead.getDate() + 7);

  const matchesFilters = (task) => {
    if (query) {
      const haystack = `${task.title} ${task.description}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    if (priorityValue !== 'all' && task.priority !== priorityValue) return false;
    if (tagValue) {
      const tags = (task.tags || []).map((tag) => tag.toLowerCase());
      if (!tags.some((tag) => tag.includes(tagValue))) return false;
    }
    if (dueValue !== 'all') {
      if (!task.dueDate) return dueValue === 'none';
      const dueDate = new Date(task.dueDate);
      if (Number.isNaN(dueDate.getTime())) return dueValue === 'none';
      dueDate.setHours(0, 0, 0, 0);
      if (dueValue === 'overdue') return dueDate < now;
      if (dueValue === 'today') return dueDate.getTime() === now.getTime();
      if (dueValue === 'week') return dueDate >= now && dueDate <= weekAhead;
      if (dueValue === 'none') return false;
    }
    return true;
  };

  return {
    todo: boardState.todo.filter(matchesFilters),
    doing: boardState.doing.filter(matchesFilters),
    done: boardState.done.filter(matchesFilters)
  };
}

function updateStats() {
  const total = boardState.todo.length + boardState.doing.length + boardState.done.length;
  statTotal.textContent = total;
  statDoing.textContent = boardState.doing.length;
  statDone.textContent = boardState.done.length;
}

async function addTask(title, description, priority, dueDate, tags) {
  boardState.todo.unshift({ id: generateId(), title, description, priority, dueDate, tags });
  await persistBoard();
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginError.textContent = '';
  const formData = new FormData(loginForm);

  try {
    const data = await login(formData.get('username'), formData.get('password'));
    setToken(data.token);
    showBoard();
    boardState = await fetchBoard();
    renderBoard();
  } catch (error) {
    loginError.textContent = error.message || 'Erro inesperado.';
  }
});

logoutButton.addEventListener('click', logout);
refreshButton.addEventListener('click', async () => {
  try {
    boardState = await fetchBoard();
    renderBoard();
  } catch (error) {
    alert(error.message || 'Erro ao atualizar');
  }
});

boardSection.addEventListener('click', (event) => {
  const target = event.target;
  if (target.matches('[data-action="add"]')) {
    openModal();
  }
});

newTaskButton.addEventListener('click', () => openModal());
cancelTask.addEventListener('click', closeModal);

modal.addEventListener('click', (event) => {
  if (event.target === modal) {
    closeModal();
  }
});

taskForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(taskForm);
  const title = formData.get('title');
  const description = formData.get('description');
  const priority = formData.get('priority');
  const dueDate = formData.get('dueDate');
  const tags = normalizeTags(formData.get('tags'));

  if (!title) return;
  if (activeTaskId) {
    updateTask(activeTaskId, { title, description, priority, dueDate, tags });
  } else {
    await addTask(title, description, priority, dueDate, tags);
  }
  closeModal();
});

async function init() {
  if (getToken()) {
    try {
      showBoard();
      boardState = await fetchBoard();
      renderBoard();
      return;
    } catch (error) {
      setToken(null);
    }
  }
  showLogin();
}

init();

function updateTask(taskId, updates) {
  const columns = ['todo', 'doing', 'done'];
  for (const column of columns) {
    const task = boardState[column].find((item) => item.id === taskId);
    if (task) {
      Object.assign(task, updates);
      persistBoard();
      return;
    }
  }
}

[searchInput, priorityFilter, tagFilter, dueFilter].forEach((control) => {
  control.addEventListener('input', () => renderBoard());
});
