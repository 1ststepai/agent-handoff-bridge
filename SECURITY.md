# Security

Please report vulnerabilities privately through GitHub's security advisory feature for this repository. Do not open a public issue containing credentials, exploit details, or private task data.

The bridge binds to `127.0.0.1` by default. Use TLS when exposing it remotely, keep every actor token distinct, and rotate any token that may have entered logs or chat. Task text and results must never contain secrets.
