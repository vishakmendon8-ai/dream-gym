# Dream Gym — Secureye Local LAN Bridge & ADMS Push Server

Run this lightweight bridge on a **gym PC or laptop connected to the same Wi-Fi/LAN** as your Secureye biometric machine (`SN: 102026020002110`).

Because your Secureye machine has **TCP/IP ON** and **Menu → Comm. → Cloud Server / ADMS / Server Setting**, it pushes every fingerprint/face/card punch **instantly over local Wi-Fi** to this PC, and this bridge validates membership expiry and mirrors every punch live into **Dream Gym Firebase Firestore (`gym001-50a97`)**.

---

## 5-Minute Gym PC Setup

### Step 1 — Prerequisites on the Gym PC
- Install **Node.js 22 LTS** (https://nodejs.org/).
- Connect the PC to the **same Wi-Fi/router** as the Secureye machine (`192.168.1.x`).

### Step 2 — Enable Live Firebase Sync (Recommended)
1. Open [Firebase Console → Project Settings → Service Accounts](https://console.firebase.google.com/project/gym001-50a97/settings/serviceaccounts/adminsdk).
2. Click **Generate New Private Key** and save the JSON file as:
   `adms-server/serviceAccountKey.json`
3. *(Never commit `serviceAccountKey.json` to Git — it is already in `.gitignore`.)*

### Step 3 — Start the Bridge
- **Windows:** Double-click `start-bridge.bat` (or run `npm install && npm start` in Command Prompt inside `adms-server/`).
- **macOS / Linux:** Run `chmod +x start-bridge.sh && ./start-bridge.sh`.

On startup, the terminal prints **this PC's LAN IP** (for example `192.168.1.50`) and the exact values to enter on your Secureye machine!

### Step 4 — Allow Port 8080 in Windows Firewall (Windows Only)
If the Secureye machine cannot reach your PC over Wi-Fi, allow TCP port `8080` on Private networks (run PowerShell as Administrator once):
```powershell
New-NetFirewallRule -DisplayName "Dream Gym Secureye ADMS Bridge" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow -Profile Private
```

### Step 5 — Configure the Secureye Biometric Machine
On the Secureye touchscreen/keypad:
1. Open **Menu → Comm. (Communication) → Cloud Server Setting** (or **ADMS / Server Setting**).
2. Enter:
   - **Server Mode:** `ADMS` *(if shown)*
   - **Enable Domain Name:** `OFF`
   - **Server Address:** `<YOUR_GYM_PC_LAN_IP>` *(shown in the bridge console, e.g. `192.168.1.50` — do NOT add `http://` or `/iclock/cdata`)*
   - **Server Port:** `8080`
   - **Enable Proxy Server:** `OFF`
   - **HTTPS:** `OFF`
3. Save and reboot the Secureye machine.
4. Within 10–30 seconds you will see `[ADMS] GET /iclock/cdata?SN=102026020002110...` in the console and the device will switch to **ONLINE** in **Dream Gym → Biometric → Secureye LAN Bridge**!

---

## Test LAN TCP/IP Connectivity Anytime
To verify your gym PC can reach the Secureye machine over TCP/IP (`192.168.1.101`):
```bash
npm run probe
# Or specify a custom IP:
node src/lanProbe.js 192.168.1.101 4000,4370,5005,80
```

## Endpoints
- **ADMS Hardware Push:** `GET/POST /iclock/cdata` (`ATTLOG` & `RTLOG`), `GET /iclock/getrequest`, `POST /iclock/devicecmd`
- **REST & Diagnostics:** `GET /health`, `GET /api/lan/probe`, `GET/POST /api/devices`, `GET /api/attendance`, `GET /api/debug/raw`
- **Built-in Live Monitor:** `http://localhost:8080/`
