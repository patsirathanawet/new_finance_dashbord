export function exportToCSV(data: Record<string, unknown>[], filename: string): void {
  if (!data || data.length === 0) {
    alert('ไม่มีข้อมูลสำหรับส่งออก');
    return;
  }

  const headers = Object.keys(data[0]);
  const csvRows = [
    headers.join(','),
    ...data.map((row) =>
      headers
        .map((header) => {
          const value = row[header];
          const cell = value === null || value === undefined ? '' : String(value);
          // Escape commas and quotes
          if (cell.includes(',') || cell.includes('"') || cell.includes('\n')) {
            return `"${cell.replace(/"/g, '""')}"`;
          }
          return cell;
        })
        .join(',')
    ),
  ];

  const csvContent = '\uFEFF' + csvRows.join('\n'); // BOM for Thai characters
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `${filename}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportTableToCSV(tableId: string, filename: string): void {
  const table = document.getElementById(tableId);
  if (!table) {
    alert('ไม่พบตาราง');
    return;
  }

  const rows = Array.from(table.querySelectorAll('tr'));
  const csvRows = rows.map((row) => {
    const cells = Array.from(row.querySelectorAll('th, td'));
    return cells
      .map((cell) => {
        const text = (cell as HTMLElement).innerText.replace(/"/g, '""');
        return `"${text}"`;
      })
      .join(',');
  });

  const csvContent = '\uFEFF' + csvRows.join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `${filename}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
