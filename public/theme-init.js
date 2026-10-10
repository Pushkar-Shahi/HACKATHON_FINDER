// Applies the saved/system theme before first paint to avoid a light-mode flash.
(function () {
	var t = null;
	try {
		t = localStorage.getItem("hackradar.theme");
	} catch (e) {}
	var dark = t === "dark" || (t !== "light" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
	if (dark) document.documentElement.classList.add("dark");
})();
