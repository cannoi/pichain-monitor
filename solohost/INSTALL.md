# Install on SoloHost

1. Open SoloHost in Pi Desktop.
2. Create/add an app using the two files in this folder:
   - docker-compose.yml
   - config_options.yml
3. Save the configuration and start the app.
4. If SoloHost reports an image or configuration error, return to App Builder and paste the error.

The Builder keeps the previous project context so it can continue troubleshooting without asking you to repeat the whole process.


PiChain Monitor version is sourced from `package.json` (current package version: 2.3.0). Mount `/app/data` persistently. For custom private Pi Node endpoints, explicitly set `HORIZON_ALLOW_PRIVATE=1` only after verifying the destination.
