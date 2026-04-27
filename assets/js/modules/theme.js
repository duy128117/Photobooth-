const STORAGE_KEY = "photobooth-theme";

export function applyStoredTheme() {
  const storedTheme = window.localStorage.getItem(STORAGE_KEY);
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const isDarkMode = storedTheme ? storedTheme === "dark" : prefersDark;
  document.body.classList.toggle("dark-mode", isDarkMode);
  return isDarkMode;
}

export function initializeTheme(themeToggle) {
  const isDarkMode = applyStoredTheme();
  updateThemeToggle(themeToggle, isDarkMode);

  if (!themeToggle) {
    return;
  }

  themeToggle.addEventListener("click", function () {
    const nextIsDarkMode = !document.body.classList.contains("dark-mode");
    document.body.classList.toggle("dark-mode", nextIsDarkMode);
    window.localStorage.setItem(STORAGE_KEY, nextIsDarkMode ? "dark" : "light");
    updateThemeToggle(themeToggle, nextIsDarkMode);
  });
}

function updateThemeToggle(themeToggle, isDarkMode) {
  if (!themeToggle) {
    return;
  }

  const themeToggleText = themeToggle.querySelector(".theme-toggle__text");
  const themeToggleIcon = themeToggle.querySelector(".theme-toggle__icon");

  themeToggle.setAttribute("aria-label", isDarkMode ? "Chuyển sang chế độ sáng" : "Chuyển sang chế độ tối");
  if (themeToggleText) {
    themeToggleText.textContent = isDarkMode ? "Sáng" : "Tối";
  }
  if (themeToggleIcon) {
    themeToggleIcon.textContent = isDarkMode ? "S" : "T";
  }
}
