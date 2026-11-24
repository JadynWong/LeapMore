const url = new URL(location.href);
history.replaceState(null, '', url.pathname);
sessionStorage.setItem('leapmore.auth.callback', url.href);
location.replace(new URL('./#/ha', url));
