const checkbox = document.getElementById("enabled");

browser.storage.local.get({ enabled: true }).then(({ enabled }) => {
  checkbox.checked = enabled;
});

checkbox.addEventListener("change", () => {
  browser.storage.local.set({ enabled: checkbox.checked });
});
