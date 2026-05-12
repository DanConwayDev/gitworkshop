// Runs synchronously in <head> before paint to avoid a light/dark flash.
// localStorage.theme is one of: "light" | "dark" | "system" (or missing,
// which is treated as "system"). When the mode is "system" we follow the
// OS via prefers-color-scheme. The full mode-tracking logic lives in the
// app (src/services/settings.ts) — this script only sets the initial class.
(function () {
  // One-time migration: the previous binary toggle called persist() without
  // a defaultValue, which caused localStorage.theme to be auto-written on
  // every page load — even for users who never clicked it. Reset the key
  // once on upgrade so the new "system" default takes effect. Runs before
  // the class is applied so there is no flash on first load after upgrade.
  if (!localStorage.getItem("themeMigratedV2")) {
    localStorage.setItem("themeMigratedV2", "1");
    localStorage.removeItem("theme");
  }

  var saved = localStorage.getItem("theme");
  var mode = saved === "light" || saved === "dark" ? saved : "system";
  var dark =
    mode === "dark" ||
    (mode === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  if (dark) document.documentElement.classList.add("dark");
})();
