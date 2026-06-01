import { useCallback, useEffect, useState } from "react";
import MapView from "./components/MapView";

const USERS_STORAGE_KEY = "lahore15.auth.users.v1";
const SESSION_STORAGE_KEY = "lahore15.auth.session.v1";

const ROUTES = {
  root: "/",
  login: "/login",
  register: "/register",
  dashboard: "/dashboard",
  admin: "/admin"
};

const KNOWN_ROUTES = new Set(Object.values(ROUTES));

function normalizePath(pathname) {
  if (!pathname || pathname === "") {
    return ROUTES.root;
  }

  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }

  return pathname;
}

function readJsonArray(key) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readJsonObject(key) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function saveUsers(users) {
  window.localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(users));
}

function saveSession(sessionUser) {
  window.localStorage.setItem(
    SESSION_STORAGE_KEY,
    JSON.stringify(sessionUser)
  );
}

function clearSession() {
  window.localStorage.removeItem(SESSION_STORAGE_KEY);
}

function AppLink({ to, onNavigate, className, children }) {
  return (
    <a
      href={to}
      className={className}
      onClick={(event) => {
        event.preventDefault();
        onNavigate(to);
      }}
    >
      {children}
    </a>
  );
}

function AuthPage({ mode, onSubmit, onNavigate, errorMessage }) {
  const isLoginMode = mode === "login";
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: ""
  });

  function updateField(key, value) {
    setFormData((previous) => ({
      ...previous,
      [key]: value
    }));
  }

  function handleSubmit(event) {
    event.preventDefault();
    onSubmit(formData);
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <h1 className="auth-title">
          {isLoginMode ? "Sign In" : "Create Account"}
        </h1>
        <p className="auth-subtitle">
          Lahore 15 min neighborhood profile
        </p>

        <form className="auth-form" onSubmit={handleSubmit}>
          {!isLoginMode && (
            <label className="auth-field">
              <span>Full Name</span>
              <input
                type="text"
                value={formData.name}
                onChange={(event) => updateField("name", event.target.value)}
                placeholder="Enter your name"
                required
              />
            </label>
          )}

          <label className="auth-field">
            <span>Email</span>
            <input
              type="email"
              value={formData.email}
              onChange={(event) => updateField("email", event.target.value)}
              placeholder="Enter your email"
              required
            />
          </label>

          <label className="auth-field">
            <span>Password</span>
            <input
              type="password"
              value={formData.password}
              onChange={(event) => updateField("password", event.target.value)}
              placeholder="Enter your password"
              required
            />
          </label>

          {!isLoginMode && (
            <label className="auth-field">
              <span>Confirm Password</span>
              <input
                type="password"
                value={formData.confirmPassword}
                onChange={(event) =>
                  updateField("confirmPassword", event.target.value)
                }
                placeholder="Re-enter your password"
                required
              />
            </label>
          )}

          {errorMessage ? (
            <p className="auth-error">{errorMessage}</p>
          ) : null}

          <button type="submit" className="auth-submit">
            {isLoginMode ? "Login" : "Register"}
          </button>
        </form>

        <p className="auth-switch">
          {isLoginMode ? "New here?" : "Already have an account?"}{" "}
          <AppLink
            to={isLoginMode ? ROUTES.register : ROUTES.login}
            onNavigate={onNavigate}
            className="auth-switch-link"
          >
            {isLoginMode ? "Create account" : "Sign in"}
          </AppLink>
        </p>
      </div>
    </div>
  );
}

function DashboardHeader({ onNavigate, onLogout, isAdminPage }) {
  return (
    <header className="dashboard-header">
      <h1 className="dashboard-title">
        Lahore 15 min neighborhood profile
      </h1>

      <nav className="dashboard-actions" aria-label="Dashboard actions">
        {isAdminPage ? (
          <AppLink
            to={ROUTES.dashboard}
            onNavigate={onNavigate}
            className="dashboard-link-button"
          >
            Dashboard
          </AppLink>
        ) : (
          <AppLink
            to={ROUTES.admin}
            onNavigate={onNavigate}
            className="dashboard-link-button"
          >
            Admin
          </AppLink>
        )}

        <button
          type="button"
          className="dashboard-link-button secondary"
          onClick={onLogout}
        >
          Logout
        </button>
      </nav>
    </header>
  );
}

function App() {
  const [currentPath, setCurrentPath] = useState(() =>
    normalizePath(window.location.pathname)
  );
  const [users, setUsers] = useState(() => readJsonArray(USERS_STORAGE_KEY));
  const [sessionUser, setSessionUser] = useState(() =>
    readJsonObject(SESSION_STORAGE_KEY)
  );
  const [authError, setAuthError] = useState("");

  const isAuthenticated = Boolean(sessionUser?.email);

  const navigate = useCallback((targetPath, replace = false) => {
    const normalized = normalizePath(targetPath);
    const current = normalizePath(window.location.pathname);

    if (normalized === current) {
      setCurrentPath(normalized);
      return;
    }

    if (replace) {
      window.history.replaceState({}, "", normalized);
    } else {
      window.history.pushState({}, "", normalized);
    }

    setCurrentPath(normalized);
  }, []);

  useEffect(() => {
    function handlePopState() {
      setCurrentPath(normalizePath(window.location.pathname));
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    const activePath = normalizePath(currentPath);
    let redirectPath = null;

    if (!KNOWN_ROUTES.has(activePath)) {
      redirectPath = isAuthenticated ? ROUTES.dashboard : ROUTES.login;
    } else if (
      !isAuthenticated &&
      (activePath === ROUTES.root ||
        activePath === ROUTES.dashboard ||
        activePath === ROUTES.admin)
    ) {
      redirectPath = ROUTES.login;
    } else if (
      isAuthenticated &&
      (activePath === ROUTES.root ||
        activePath === ROUTES.login ||
        activePath === ROUTES.register)
    ) {
      redirectPath = ROUTES.dashboard;
    }

    if (redirectPath && redirectPath !== activePath) {
      const timeoutId = window.setTimeout(() => {
        navigate(redirectPath, true);
      }, 0);

      return () => window.clearTimeout(timeoutId);
    }
  }, [currentPath, isAuthenticated, navigate]);

  const handleLogin = useCallback(
    (formData) => {
      const email = formData.email.trim().toLowerCase();
      const password = formData.password;

      if (!email || !password) {
        setAuthError("Email and password are required.");
        return;
      }

      const account = users.find(
        (user) => user.email.toLowerCase() === email
      );

      if (!account || account.password !== password) {
        setAuthError("Invalid email or password.");
        return;
      }

      const session = {
        name: account.name,
        email: account.email
      };

      saveSession(session);
      setSessionUser(session);
      setAuthError("");
      navigate(ROUTES.dashboard, true);
    },
    [navigate, users]
  );

  const handleRegister = useCallback(
    (formData) => {
      const name = formData.name.trim();
      const email = formData.email.trim().toLowerCase();
      const password = formData.password;
      const confirmPassword = formData.confirmPassword;

      if (!name || !email || !password || !confirmPassword) {
        setAuthError("Please fill all required fields.");
        return;
      }

      if (password.length < 6) {
        setAuthError("Password must be at least 6 characters.");
        return;
      }

      if (password !== confirmPassword) {
        setAuthError("Passwords do not match.");
        return;
      }

      if (users.some((user) => user.email.toLowerCase() === email)) {
        setAuthError("This email is already registered.");
        return;
      }

      const updatedUsers = [
        ...users,
        {
          name,
          email,
          password
        }
      ];

      saveUsers(updatedUsers);
      setUsers(updatedUsers);

      const session = { name, email };
      saveSession(session);
      setSessionUser(session);
      setAuthError("");
      navigate(ROUTES.dashboard, true);
    },
    [navigate, users]
  );

  const handleLogout = useCallback(() => {
    clearSession();
    setSessionUser(null);
    setAuthError("");
    navigate(ROUTES.login, true);
  }, [navigate]);

  const activePath = normalizePath(currentPath);

  if (!isAuthenticated && activePath === ROUTES.register) {
    return (
      <AuthPage
        mode="register"
        onSubmit={handleRegister}
        onNavigate={navigate}
        errorMessage={authError}
      />
    );
  }

  if (!isAuthenticated) {
    return (
      <AuthPage
        mode="login"
        onSubmit={handleLogin}
        onNavigate={navigate}
        errorMessage={authError}
      />
    );
  }

  if (activePath === ROUTES.admin) {
    return (
      <div className="dashboard-shell">
        <DashboardHeader
          onNavigate={navigate}
          onLogout={handleLogout}
          isAdminPage
        />

        <main className="admin-page">
          <div className="admin-card">
            <h2>Admin Page</h2>
            <p>Signed in as {sessionUser?.name ?? sessionUser?.email}</p>
            <p>You can extend this section for user management and reports.</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="dashboard-shell">
      <DashboardHeader
        onNavigate={navigate}
        onLogout={handleLogout}
        isAdminPage={false}
      />

      <main className="dashboard-main">
        <MapView />
      </main>
    </div>
  );
}

export default App;
