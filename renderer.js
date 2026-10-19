const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const status = document.getElementById('connection-status');
const reconnectButton = document.getElementById('reconnect');
const chatPanel = document.getElementById('chat-panel');
const form = document.getElementById('form');
const input = document.getElementById('input');
const messages = document.getElementById('messages');

function updateConnectionStatus(message) {
  const connected = message === 'Connected';

  status.textContent = message;
  reconnectButton.hidden = connected;
  loginForm.hidden = connected;
  chatPanel.hidden = !connected;
  form.hidden = !connected;
  messages.hidden = !connected;
}

window.exposed.onStatus((message) => {
  updateConnectionStatus(message);
});

window.exposed.onError((message) => {
  loginError.textContent = message;
});

window.exposed.onMessage((message) => {
  const item = document.createElement('li');
  item.textContent = String(message);
  messages.appendChild(item);
  window.scrollTo(0, document.body.scrollHeight);
});

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginError.textContent = '';

  try {
    await window.exposed.login({
      email: emailInput.value,
      password: passwordInput.value
    });
    passwordInput.value = '';
  } catch (error) {
    loginError.textContent = error.message || 'Login failed.';
  }
});

reconnectButton.addEventListener('click', async () => {
  loginError.textContent = '';

  try {
    await window.exposed.reconnect();
  } catch (error) {
    loginError.textContent = error.message || 'Could not reconnect.';
  }
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const message = input.value.trim();
  if (!message) return;

  try {
    await window.exposed.sendMessage(message);
    input.value = '';
  } catch (error) {
    loginError.textContent = error.message || 'Could not send message.';
  }
});

updateConnectionStatus('Log in to connect');

window.exposed.reconnect().catch(() => {
  // No saved session is normal on first launch; the login form is ready.
});