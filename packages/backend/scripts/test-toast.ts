import { execFile } from "node:child_process";

const title = "Claude_Agent";
const message = "Test toast — ถ้าเห็นนี่แสดงว่าใช้งานได้";

const ps = `[Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime]|Out-Null;[Windows.Data.Xml.Dom.XmlDocument,Windows.Data.Xml.Dom,ContentType=WindowsRuntime]|Out-Null;$x=[Windows.Data.Xml.Dom.XmlDocument]::new();$x.LoadXml('<toast><visual><binding template="ToastGeneric"><text>${title}</text><text>${message}</text></binding></visual></toast>');[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Claude_Agent').Show([Windows.UI.Notifications.ToastNotification]::new($x))`;

console.log("Firing toast...");
execFile(
  "powershell.exe",
  ["-NonInteractive", "-WindowStyle", "Hidden", "-Command", ps],
  { timeout: 8000, windowsHide: true },
  (err, stdout, stderr) => {
    if (err) {
      console.error("FAILED:", err.message);
      if (stderr) console.error("stderr:", stderr);
    } else {
      console.log("Toast sent OK");
    }
  },
);
