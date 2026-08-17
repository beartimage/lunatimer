// Shared behavior for the lunatimer marketing + info pages.
// (The timer app itself uses script.js — this file is for the static pages only.)

// "Sign in" is a placeholder until accounts ship — surface a friendly note.
(function () {
    var toast = document.getElementById('toast');
    var t;
    function showToast(msg) {
        if (!toast) return;
        toast.textContent = msg;
        toast.classList.add('show');
        clearTimeout(t);
        t = setTimeout(function () { toast.classList.remove('show'); }, 2600);
    }
    document.querySelectorAll('[data-signin]').forEach(function (b) {
        b.addEventListener('click', function () { showToast('Sign-in is coming soon.'); });
    });
})();

// Register the service worker so the pages work offline.
if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').then(function (reg) { reg.update(); }).catch(function () {});
    });
}
