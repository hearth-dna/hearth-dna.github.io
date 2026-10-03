// An installed Hearth (it was installed when the app lived at /) opens straight into the app.
if (matchMedia('(display-mode: standalone)').matches) location.replace('/app/')
