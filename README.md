# ♦♣♥♠ Antigravity Poker: Real-Time Tournament Manager

Antigravity Poker is a premium, multi-platform, real-time poker tournament manager designed for home games and local club tournaments. It features a dual-device synchronization model that allows you to run a full-screen tournament dashboard on a projector or TV screen while managing the game (clock, rebuys, payouts, and players) remotely from your mobile phone.

Built with **Node.js, Express, WebSockets (ws)**, and custom **Vanilla CSS**, this application runs entirely locally and offline, ensuring zero clock drift, latency-free updates, and zero external dependencies.

---

## 🚀 Key Features

### 📺 High-Visibility TV Dashboard View
* **Extra Large Timer Display**: Large countdown clock optimized for readability on projectors or large TV displays.
* **Widescreen Balanced Layout**: Designed in a premium **Obsidian Dark** aesthetic with neon emerald and cyan highlights.
* **Instant visual alerts**: Clock digits turn pulsing red when time is low (< 30s) and flash green on level changes.
* **Side-by-Side Live widgets**: Displays current/upcoming blinds, payout structures, chip value colors, active player counts, total prize pool, and a scrolling bottom status ticker.
* **Zero Scrolling**: Auto-fits laptop and TV screens with responsive grid styling and absolute sizing.

### 📱 Real-Time Mobile Admin Console
* **Instant QR Pairing**: Connect another tablet or phone to the same Wi-Fi network and scan the pairing QR code to control the game instantly.
* **Central WebSocket Clock**: The clock runs on the central server. If the admin's phone goes to sleep, the TV projector screen continues counting down accurately, and the admin panel resynchronizes immediately upon wake.
* **Interactive Player Manager**: Add players, record entry buy-ins, track individual rebuys/add-ons, and record busts. Busting players can be revived instantly by registering a rebuy.
* **Intelligent Blinds Calculator**: Recalculate blinds dynamically based on target playtime, level duration, and available chip inventory.
* **Flexible Payouts Engine**: Choose the number of paid places (1-10) and adjust weights with sliders or text inputs. Includes an **Auto-Balance** button to automatically normalize ratios to 100% using standard curves.

### 🪙 Dynamic Chip Inventory Management
* **Breakout Solver**: Input your exact chip inventory quantities and values. The app automatically calculates the ideal starting stack size, recommended denominations, and exactly how many chips of each color to cut out for each player.
* **Real-time Color Sync**: Typing standard color names (e.g. Pink, Purple, Lavender, Red) in Settings auto-fills the color picker and preview pills instantly.
* **Dynamic lookups**: TV display resolves colors dynamically from Settings to prevent desynchronization.

### 🔊 Native Web Audio Chime Alerts
* **Offline Synthesizer**: Uses the browser's native **Web Audio API** to synthesize a three-tone rising chime followed by a resonant bell gong on level transition (100% offline, zero lag or autoplay blockages).

---

## 🛠️ Technology Stack
* **Backend**: Node.js, Express
* **Real-Time Sync**: WebSockets (`ws` package)
* **Frontend**: Pure HTML5, Vanilla CSS3 (Custom Variables, Flexbox, CSS Grid), ES6 Javascript
* **Chime System**: Web Audio API (Tone Synthesizer)
* **Pairing**: Server-side QR Code compiler (`qrcode` package)

---

## 📦 Installation & Getting Started

### Prerequisites
Make sure you have Node.js (version 16 or higher) installed on your system.

### 1. Setup the Project
Clone the repository and install the dependencies:
```bash
git clone https://github.com/markrizko/pt-manager.git
cd pt-manager
npm install
```

### 2. Start the Server
Run the local server:
```bash
npm start
```
*(If running inside WSL Linux, run `wsl npm start`)*

Upon booting, the server will output your local server access URLs and LAN pairing links:
```text
=======================================================
Poker Tournament Manager Server started successfully!
Local Access: http://localhost:3000
Network Access (Use your phone/tablet):
  http://192.168.1.202:3000
=======================================================
```

---

## 📱 Connecting Multiple Devices

### 1. Launch the TV screen
1. Open a browser on the laptop/PC connected to your projector or TV.
2. Go to: `http://localhost:3000`
3. Click **TV Timer Display (Open Big Screen)**.
4. Toggle Fullscreen mode using the icon (`⛶`) in the top right.

### 2. Connect the mobile controller (Admin)
1. Ensure your phone/tablet is connected to the **same Wi-Fi network** as the host computer.
2. Scan the **pairing QR code** displayed on either the Welcome screen or the scrolling bottom ticker on the TV screen.
3. The Admin panel will open immediately. Tap the tabs to manage players, trigger breaks, edit payouts, or save settings!

---

## 🖥️ WSL2 Network User Notes (NAT Bridging)
WSL2 runs on a virtual network behind a NAT, which blocks direct Wi-Fi connections from your phone. If you are running the server in WSL2, configure port-forwarding to make the server accessible:

Run this command in **Windows PowerShell (as Administrator)**:
```powershell
netsh interface portproxy add v4tov4 listenport=3000 listenaddress=0.0.0.0 connectport=3000 connectaddress=YOUR_WSL_IP
```
*(Replace `YOUR_WSL_IP` with the internal WSL IP address printed on your terminal console at startup).*

---

## 📄 License
This project is open-source and available under the [MIT License](LICENSE).
