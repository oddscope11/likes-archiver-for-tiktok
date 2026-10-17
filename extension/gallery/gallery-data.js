// Used only when the extension opens the gallery. The copy of the gallery in
// the archive folder has a file of the same name holding the data instead.
window.GALLERY_SOURCE = (() => {
  const urls = new Map();
  return {
    href: (path) => urls.get(path) ?? "",
    load: async (report) => (await import("./source.js")).load(urls, report)
  };
})();
