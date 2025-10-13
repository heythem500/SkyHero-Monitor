// utils.js - Utility functions for the Superman-Tacking dashboard
// MIGRATION STATUS: PHASE 3

/*
  Related: Multiple files use formatBytes
  Used by: All modules that need to format data sizes
  MIGRATION STATUS: PHASE 3
*/

/**
 * Format bytes into human-readable format (GB/MB/KB/B)
 * @param {number} bytes - Size in bytes
 * @returns {string} Formatted string with appropriate unit
 */
function formatBytes(bytes) {
    if (bytes === 0) {
        // For consistency with old display, show 0 bytes as 0 MB
        return "0 MB";
    } else if (bytes < 1024) { // Less than 1 KB
        return `${Math.round(bytes)} B`;
    } else if (bytes < 1048576) { // Less than 1 MB
        const kbytes = bytes / 1024;
        return `${Math.round(kbytes)} KB`;
    } else if (bytes < 1073741824) { // Less than 1 GB
        const mbytes = bytes / 1048576;
        return `${Math.round(mbytes)} MB`;
    } else {
        const gbytes = bytes / 1073741824;
        return `${gbytes.toFixed(2)} GB`;
    }
}

/**
 * Generate a sparkline SVG from data
 * @param {Array<number>} data - Array of data points
 * @returns {string} SVG string representing the sparkline
 */
function generateSparkline(data) {
    if (!data || data.length === 0) return '<span>No data</span>';
    const width = 100;
    const height = 20;
    const max = Math.max(...data);
    const points = data.map((d, i) => {
        const x = (width / (data.length - 1)) * i;
        const y = height - (d / max) * height;
        return `${x},${y}`;
    }).join(' ');

    return `<svg viewbox="0 0 ${width} ${height}" class="sparkline"><polyline points="${points}" fill="none" stroke="#0d6efd" stroke-width="1"></polyline></svg>`;
}

/**
 * Render a bar chart as SVG
 * @param {Array<number>} data - Array of data points
 * @returns {string} SVG string representing the bar chart
 */
function renderDeviceBarChart(data) {
    if (!data || data.length === 0) return '<span>No data</span>';
    const width = 120;
    const height = 24;
    const barWidth = 12; // Fixed bar width
    const gap = 2;
    const max = Math.max(...data);
    const numBars = data.length;

    const bars = data.map((d, i) => {
        const barHeight = (d / max) * height;
        const x = width - (numBars - i) * (barWidth + gap);
        const y = height - barHeight;
        const isToday = i === data.length - 1;
        return `<rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" fill="${isToday ? '#0d6efd' : '#6c757d'}" rx="1"></rect>`;
    }).join('');

    return `<svg viewbox="0 0 ${width} ${height}" class="sparkline-bar-chart">${bars}</svg>`;
}

// Export functions for use in other modules
export { formatBytes, generateSparkline, renderDeviceBarChart };