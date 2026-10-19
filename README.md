# SmartSTB Clone for Samsung Tizen TVs

A lightweight, custom Tizen TV web application built to interface with Stalker portals using native JavaScript and the Samsung `avplay` video player.

## Disclaimer

This project is an independent media client. It does not provide, bundle, or distribute any media streams, content, or portal subscriptions. Users must supply their own backend proxy and portal credentials.

---

## Setup & Installation Tutorial

### Prerequisites
* **Tizen Studio** installed on your PC.
* A Samsung Tizen TV (2018 or newer) running Tizen 4.0+ with **Developer Mode** enabled.

---

### Installation & Configuration
1. **Clone the repository** to your local machine:
   ```bash
   git clone [https://github.com/Rusty24h/SmartSTBclone.git](https://github.com/Rusty24h/SmartSTBclone.git)
2. Build the ⁠.wgt⁠ package: Open Tizen Studio, go to File > Import > Tizen > Existing Tizen Web Project, select your folder, right-click the project in the Project Explorer, select Build WGT Package, and sign it with your local Samsung developer certificate.
3. Sideload to your TV: Open the Tizen Device Manager, connect to your TV's local IP address in Developer Mode, right-click the generated ⁠.wgt⁠ file, and select Install Application.
4. Configure your portal: Launch the app on your Samsung TV and enter your Stalker/Ministra portal URL and registered MAC address directly into the on-screen settings.
