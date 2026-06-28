# คู่มือการใช้งาน BMS Session ID

> เอกสารนี้อธิบายวิธีการใช้งาน BMS Session ID ตั้งแต่การได้มา การนำไปใช้ การ Query ข้อมูล และการรับผลลัพธ์
> ระบบนี้ใช้สำหรับเชื่อมต่อกับฐานข้อมูล HOSxP ของโรงพยาบาล

---

## 1. BMS Session ID คืออะไร?

BMS Session ID คือ **Token ชั่วคราว** ที่ออกโดยระบบ HOSxP (Bangkok Medical Software) เพื่อยืนยันตัวตนผู้ใช้และอนุญาตให้เข้าถึงฐานข้อมูลโรงพยาบาล

- รูปแบบ: สตริงข้อความ เช่น `a1b2c3d4e5f6...`
- อายุ: จำกัด (หมดอายุแล้ว API จะตอบกลับ `MessageCode: 500`)
- ใช้เพื่อ: ดึงค่า `API URL` และ `Auth Key` มาใช้ Query ฐานข้อมูล

---

## 2. วิธีได้รับ BMS Session ID

มี 3 วิธี:

### วิธีที่ 1 — ผ่าน URL Parameter (แนะนำ)
ระบบต้นทาง (HOSxP) ส่ง Session ID มาพร้อมกับ URL เมื่อเปิดแอป

```
https://your-app.com/?bms-session-id=SESSION_ID_HERE
```

ระบบจะ:
1. ดึง `bms-session-id` จาก URL อัตโนมัติ
2. บันทึกลง Cookie อายุ 7 วัน
3. ลบ parameter ออกจาก URL (URL จะสะอาด)

### วิธีที่ 2 — ผ่าน Cookie (อัตโนมัติ)
หลังจากเคยใช้ Session ID สำเร็จแล้ว ระบบจะจำไว้ใน Cookie 7 วัน ครั้งต่อไปไม่ต้องกรอกใหม่

### วิธีที่ 3 — กรอกด้วยตนเอง (Manual Input)
ผู้ใช้พิมพ์ Session ID ลงในช่อง Input บนหน้าเว็บโดยตรง

---

## 3. หลังได้ Session ID แล้ว ทำอะไรต่อ?

### ขั้นตอนที่ 1 — ยืนยัน Session กับ HOSxP API

ส่ง HTTP GET ไปที่ endpoint:

```
GET https://hosxp.net/phapi/PasteJSON?Action=GET&code={SESSION_ID}
```

**ตัวอย่าง:**
```
GET https://hosxp.net/phapi/PasteJSON?Action=GET&code=a1b2c3d4e5f6
```

**Headers:**
```
Content-Type: application/json
Accept: application/json
```

---

### ขั้นตอนที่ 2 — รับ Response และตรวจสอบ MessageCode

Response จะเป็น JSON รูปแบบนี้:

```json
{
  "MessageCode": 200,
  "Message": "OK",
  "result": {
    "user_info": {
      "name": "นายแพทย์สมชาย",
      "location": "โรงพยาบาลตัวอย่าง",
      "doctor_code": "D001",
      "bms_url": "https://hospital-api.example.com",
      "bms_session_code": "eyJhbGciOiJIUzI1NiJ9...",
      "hosxp.api_url": "https://hospital-api.example.com",
      "hosxp.api_auth_key": "Bearer-Token-Here"
    },
    "key_value": {
      "hosxp.api_url": "https://hospital-api.example.com",
      "hosxp.api_auth_key": "Bearer-Token-Here"
    }
  }
}
```

**ตรวจสอบ `MessageCode`:**

| MessageCode | ความหมาย | การดำเนินการ |
|-------------|----------|--------------|
| `200` | สำเร็จ — Session ยังใช้งานได้ | ดำเนินการต่อ |
| `500` | Session หมดอายุแล้ว | แจ้งผู้ใช้ให้ Login ใหม่ |
| อื่นๆ | เกิดข้อผิดพลาด | แสดง Error Message |

---

### ขั้นตอนที่ 3 — ดึงค่า Connection Config

จาก Response ให้ดึงค่า 2 อย่าง:

1. **`apiUrl`** — URL ของ HOSxP API ของโรงพยาบาลนั้น
2. **`apiAuthKey`** — Auth Key สำหรับ Bearer Token

**ลำดับการค้นหาค่า (Fallback Priority):**

```
API URL ดูจาก:
  1. result.key_value["hosxp.api_url"]      ← ดูก่อน
  2. result.user_info["hosxp.api_url"]      ← ถ้าไม่เจอ
  3. result.user_info.bms_url               ← สุดท้าย

Auth Key ดูจาก:
  1. result.key_value["hosxp.api_auth_key"] ← ดูก่อน
  2. result.user_info["hosxp.api_auth_key"] ← ถ้าไม่เจอ
  3. result.user_info.bms_session_code      ← ถ้าไม่เจอ
  4. result.key_value (ถ้าเป็น string โดยตรง) ← สุดท้าย
```

**ตัวอย่าง JavaScript:**
```javascript
const apiUrl =
  data.result?.key_value?.["hosxp.api_url"] ||
  data.result?.user_info?.["hosxp.api_url"] ||
  data.result?.user_info?.bms_url;

const apiAuthKey =
  data.result?.key_value?.["hosxp.api_auth_key"] ||
  data.result?.user_info?.["hosxp.api_auth_key"] ||
  data.result?.user_info?.bms_session_code ||
  (typeof data.result?.key_value === "string" ? data.result.key_value : null);
```

---

## 4. วิธี Query ฐานข้อมูล

เมื่อได้ `apiUrl` และ `apiAuthKey` แล้ว สามารถ Query SQL ได้ผ่าน endpoint นี้:

### SQL Query Endpoint

```
GET {apiUrl}/api/sql?sql={ENCODED_SQL}&app=BMS.Dashboard.React
```

**Headers ที่ต้องส่ง:**
```
Authorization: Bearer {apiAuthKey}
Content-Type: application/json
```

**ตัวอย่าง Query:**
```
GET https://hospital-api.example.com/api/sql?sql=SELECT%201%20as%20test&app=BMS.Dashboard.React

Headers:
  Authorization: Bearer eyJhbGciOiJIUzI1NiJ9...
```

### ข้อกำหนดในการเขียน SQL

1. **Encode SQL** ด้วย `encodeURIComponent()` ก่อนใส่ใน URL เสมอ
2. **Minify SQL** ก่อนส่ง (ลบ Comment และ whitespace ซ้ำออก) เพื่อลด URL length
3. SQL เป็น `SELECT` เท่านั้น (Read-only access)

**ตัวอย่าง Minify SQL:**
```javascript
function minifySql(sql) {
  return sql
    .replace(/--.*$/gm, '')      // ลบ single-line comments
    .replace(/\/\*[\s\S]*?\*\//g, '')  // ลบ multi-line comments
    .replace(/\s+/g, ' ')        // ย่อ whitespace
    .trim();
}
```

---

## 5. ตัวอย่าง SQL Query ที่ใช้บ่อย

### ทดสอบการเชื่อมต่อ
```sql
SELECT 1 as test
```

### นับจำนวนผู้ป่วย
```sql
SELECT COUNT(*) as patient_count FROM patient
```

### สถิติรายได้รายวัน
```sql
SELECT
  vstdate,
  COUNT(*) as visit_count,
  SUM(income) as total_income
FROM vn_stat
WHERE vstdate BETWEEN '2024-01-01' AND '2024-12-31'
GROUP BY vstdate
ORDER BY vstdate DESC
```

### ข้อมูลผู้ป่วยล่าสุด
```sql
SELECT
  hn, name, age, sex, vstdate
FROM vn_stat
ORDER BY vstdate DESC
LIMIT 10
```

### สถิติตาม OPD/IPD
```sql
SELECT
  COUNT(*) as total_visit,
  SUM(CASE WHEN pdx LIKE 'J%' THEN 1 ELSE 0 END) as respiratory,
  SUM(income) as total_income
FROM vn_stat
WHERE vstdate = CURDATE()
```

---

## 6. ผลลัพธ์ที่ได้จาก Query

Response จาก `/api/sql` มีรูปแบบดังนี้:

```json
{
  "result": {},
  "MessageCode": 200,
  "Message": "OK",
  "RequestTime": "2025-09-19T21:02:32.698Z",
  "data": [
    {
      "column1": "value1",
      "column2": "value2"
    },
    {
      "column1": "value3",
      "column2": "value4"
    }
  ]
}
```

### โครงสร้าง Response

| Field | Type | ความหมาย |
|-------|------|----------|
| `MessageCode` | number | `200` = สำเร็จ, อื่นๆ = ผิดพลาด |
| `Message` | string | ข้อความสถานะ เช่น `"OK"` |
| `RequestTime` | string | เวลาที่ Server ตอบกลับ (ISO 8601) |
| `data` | array | **อาร์เรย์ของผลลัพธ์ SQL** (แต่ละ row คือ object) |
| `result` | object | ข้อมูลเสริม (มักจะว่าง `{}`) |

### ตัวอย่าง Response จริง

```json
{
  "result": {},
  "MessageCode": 200,
  "Message": "OK",
  "RequestTime": "2025-09-19T21:02:32.698Z",
  "data": [
    {
      "dashboard_url_settings_id": 2,
      "dashboard_url": "https://finance-dashboard.bmscloud.in.th/",
      "dashboard_description": "BMS Finance Dashboard",
      "dashboard_vendor": "BMS",
      "dashboard_auth_key": null,
      "update_datetime": null
    }
  ]
}
```

### การจัดการ HTTP Status Code

| HTTP Status | ความหมาย | การแก้ไข |
|-------------|----------|----------|
| `200` | สำเร็จ | ตรวจสอบ `MessageCode` ใน body อีกครั้ง |
| `401` | Unauthorized | `apiAuthKey` ผิดหรือหมดอายุ |
| `502` | Bad Gateway | Tunnel/Network มีปัญหา ลองใหม่ |
| `timeout` | หมดเวลา | Network ช้า ลองใหม่หรือลด Query ให้เล็กลง |

---

## 7. Flow ทั้งหมดสรุปในภาพเดียว

```
[ผู้ใช้]
   │
   ├─ วิธีที่ 1: เปิด URL ?bms-session-id=ABC123
   ├─ วิธีที่ 2: Cookie อัตโนมัติ
   └─ วิธีที่ 3: กรอก Session ID ด้วยตนเอง
              │
              ▼
[STEP 1] GET https://hosxp.net/phapi/PasteJSON?Action=GET&code=ABC123
              │
              ▼
[STEP 2] ตรวจสอบ Response
         ├─ MessageCode 200 → ดำเนินการต่อ
         ├─ MessageCode 500 → แจ้งหมดอายุ (จบ)
         └─ Error → แจ้ง Error (จบ)
              │
              ▼
[STEP 3] ดึงค่า apiUrl และ apiAuthKey จาก result
         ├─ apiUrl   = result.key_value["hosxp.api_url"]  หรือ bms_url
         └─ apiKey   = result.key_value["hosxp.api_auth_key"] หรือ bms_session_code
              │
              ▼
[STEP 4] GET {apiUrl}/api/sql?sql={ENCODED_SQL}&app=BMS.Dashboard.React
         Headers: Authorization: Bearer {apiAuthKey}
              │
              ▼
[STEP 5] รับ Response JSON
         └─ data[] = ผลลัพธ์ SQL ทุก row
```

---

## 8. ตัวอย่าง Code เต็มรูปแบบ (JavaScript/Fetch)

```javascript
async function runBmsQuery(sessionId, sql) {

  // STEP 1: ยืนยัน Session
  const sessionRes = await fetch(
    `https://hosxp.net/phapi/PasteJSON?Action=GET&code=${encodeURIComponent(sessionId)}`
  );
  const sessionData = await sessionRes.json();

  // STEP 2: ตรวจสอบ Session
  if (sessionData.MessageCode !== 200) {
    throw new Error(`Session error: ${sessionData.MessageCode} - ${sessionData.Message}`);
  }

  // STEP 3: ดึง Connection Config
  const apiUrl =
    sessionData.result?.key_value?.["hosxp.api_url"] ||
    sessionData.result?.user_info?.["hosxp.api_url"] ||
    sessionData.result?.user_info?.bms_url;

  const apiAuthKey =
    sessionData.result?.key_value?.["hosxp.api_auth_key"] ||
    sessionData.result?.user_info?.["hosxp.api_auth_key"] ||
    sessionData.result?.user_info?.bms_session_code ||
    (typeof sessionData.result?.key_value === "string"
      ? sessionData.result.key_value
      : null);

  if (!apiUrl || !apiAuthKey) {
    throw new Error("ไม่พบ API URL หรือ Auth Key ใน session response");
  }

  // STEP 4: Minify และ Query SQL
  const minifiedSql = sql
    .replace(/--.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .trim();

  const queryUrl = `${apiUrl}/api/sql?sql=${encodeURIComponent(minifiedSql)}&app=BMS.Dashboard.React`;

  const queryRes = await fetch(queryUrl, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiAuthKey}`,
      "Content-Type": "application/json",
    },
  });

  if (queryRes.status === 401) throw new Error("Unauthorized: Auth Key ไม่ถูกต้อง");
  if (queryRes.status === 502) throw new Error("Bad Gateway: ปัญหาการเชื่อมต่อ Tunnel");
  if (!queryRes.ok) throw new Error(`HTTP Error: ${queryRes.status}`);

  // STEP 5: รับและคืนผลลัพธ์
  const queryData = await queryRes.json();

  if (queryData.MessageCode !== 200) {
    throw new Error(`Query error: ${queryData.Message}`);
  }

  return queryData.data; // ← array ของผลลัพธ์
}

// ──── การใช้งาน ────
runBmsQuery("ABC123", "SELECT COUNT(*) as total FROM patient")
  .then(rows => {
    console.log("จำนวนผู้ป่วยทั้งหมด:", rows[0].total);
  })
  .catch(err => {
    console.error("Error:", err.message);
  });
```

---

## 9. ข้อมูล User Info ที่ได้จาก Session

หลังจาก Session สำเร็จ สามารถแสดงข้อมูลผู้ใช้ได้:

```javascript
const userInfo = sessionData.result?.user_info;

console.log(userInfo.name);         // ชื่อผู้ใช้ เช่น "นายแพทย์สมชาย"
console.log(userInfo.location);     // ชื่อสถานพยาบาล เช่น "โรงพยาบาลตัวอย่าง"
console.log(userInfo.doctor_code);  // รหัสแพทย์ เช่น "D001"
```

---

## 10. ข้อควรระวัง

1. **Session หมดอายุ** — ตรวจสอบ `MessageCode: 500` เสมอ แจ้งผู้ใช้ให้ Login ใหม่
2. **Encode SQL เสมอ** — ใช้ `encodeURIComponent()` ทุกครั้งก่อนใส่ใน URL
3. **ไม่แสดง Auth Key** — อย่าแสดง `apiAuthKey` เต็มๆ ให้ผู้ใช้เห็น (log แค่บางส่วน)
4. **Timeout 10 วินาที** — HOSxP API อาจช้า ควรตั้ง timeout และมี retry logic
5. **CORS** — ถ้าเรียกจาก Browser ต้องตรวจสอบ CORS ของ HOSxP API ปลายทาง
6. **SQL เป็น Read-only** — endpoint `/api/sql` รองรับแค่ `SELECT` เท่านั้น

---

## 11. Troubleshooting

| ปัญหา | สาเหตุ | วิธีแก้ |
|-------|--------|--------|
| `MessageCode: 500` | Session หมดอายุ | Login ใหม่เพื่อรับ Session ID ใหม่ |
| `HTTP 401` | Auth Key ผิด | ตรวจสอบ `apiAuthKey` ที่ดึงมา |
| `HTTP 502` | Tunnel มีปัญหา | รอสักครู่แล้วลองใหม่ |
| `apiUrl` เป็น null | ไม่มีค่าใน result | ตรวจสอบ JSON response ว่าโครงสร้างถูกต้อง |
| Query timeout | SQL ซับซ้อนเกินไป | เพิ่ม `LIMIT` หรือลด date range |
| CORS error | Browser ไม่อนุญาต | ใช้ Proxy Server หรือตรวจสอบ CORS headers |
