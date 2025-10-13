// charts.js - Chart rendering and management functions
// MIGRATION STATUS: PHASE 3

/*
  Related: main.js → calls chart rendering functions
  Used by: FEATURE - Data Visualization
  MIGRATION STATUS: PHASE 3
*/

import { formatBytes } from './utils.js';
import { translate } from './i18n.js';

/**
 * Render all charts for the dashboard
 * @param {Object} barData - Data for the bar chart
 * @param {Array<Object>} pieData - Data for the pie chart
 * @param {Array<Object>} topAppsData - Data for the top apps chart
 */
function renderCharts(barData, pieData, topAppsData) {
    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    renderTopAppsChart(topAppsData);
    const titleElement = document.getElementById('bar-chart-title');
    titleElement.textContent = barData.title;
    const pieColors = ['#0d6efd', '#198754', '#ffc107', '#dc3545', '#6f42c1', '#fd7e14', '#20c997', '#6e450c', '#7d7378', '#0dcaf0'];

    // Bar chart - handle both period format (values_bytes) and daily format (total_bytes)
    if (window.barChart) window.barChart.destroy();
    const dailyBarChartCanvas = document.getElementById('dailyBarChart');

    // Check for single-day hourly view
    const isHourlyView = barData.labels.length === 1 && barData.hourly_values_bytes;

    // Store the view type in a global variable so event handlers can access it
    window.isHourlyView = isHourlyView;

    // Toggle state for 12h/24h view
    if (typeof window.is12hView === 'undefined') window.is12hView = true;

    let chartData, chartLabels;
    if (isHourlyView) {
        if (window.is12hView) {
            // Group 24 stored hours into 12 displayed two-hourly intervals
            chartLabels = [];
            chartData = [];
            for (let i = 0; i < 24; i += 2) {
                const startHour = i + 1;
                const endHour = i + 2;
                chartLabels.push(`${startHour}h-${endHour}h`);
                const intervalBytes = barData.hourly_values_bytes[i] + barData.hourly_values_bytes[i + 1];
                chartData.push(intervalBytes / 1073741824);
            }
        } else {
            // Display 24 individual one-hour intervals
            chartLabels = [];
            chartData = [];
            for (let i = 0; i < 24; i += 1) {
                const hour = i + 1;
                chartLabels.push(`${hour}h`);
                const intervalBytes = barData.hourly_values_bytes[i];
                chartData.push(intervalBytes / 1073741824);
            }
        }
    } else {
        // Use daily data
        chartLabels = barData.labels;
        chartData = (barData.values_bytes || [0]).map(bytes => bytes / 1073741824);
    }
    
    // Use steel blue for hourly views, blue for daily views
    const barColor = isHourlyView ? 'rgba(71, 130, 180, 0.7)' : 'rgba(13, 110, 253, 0.6)';
    const borderColor = isHourlyView ? 'rgba(71, 130, 180, 1)' : 'rgba(13, 110, 253, 1)';
    
    window.barChart = new Chart(dailyBarChartCanvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels: chartLabels,
            datasets: [{
                label: 'Total Traffic',
                data: chartData,
                backgroundColor: barColor,
                borderColor: borderColor,
                borderWidth: 1
            }]
        },
        options: { responsive: true, plugins: {
            legend: { display: false },
            tooltip: {
                callbacks: {
                    label: function (context) {
                        return context.dataset.label + ' (GB): ' + context.raw.toFixed(2);
                    }
                }
            }
        } }
    });

    // Add toggle button for hourly views
    if (isHourlyView) {
        titleElement.innerHTML = '<button id="hourly-toggle-btn" style="margin-right: 10px; padding: 5px 10px; font-size: 12px; background-color: rgba(71, 130, 180, 0.7); border-color: rgba(71, 130, 180, 1); border-width: 1px; border-style: solid; color: white; cursor: pointer;">' + (window.is12hView ? '12h' : '24h') + '</button>' + barData.title;
        const toggleBtn = document.getElementById('hourly-toggle-btn');
        toggleBtn.onclick = () => {
            window.is12hView = !window.is12hView;
            toggleBtn.textContent = window.is12hView ? '12h' : '24h';
            renderCharts(barData, pieData, topAppsData); // Re-render with new view
        };
    } else {
        titleElement.textContent = barData.title;
    }

    // Pie chart
    if (window.pieChart) window.pieChart.destroy();
    window.pieChart = new Chart(document.getElementById('devicePieChart').getContext('2d'), {
        type: 'doughnut',
        data: {
            labels: pieData.map(d => d.name),
            datasets: [{
                data: pieData.map(d => d.total_bytes / 1073741824), // Convert bytes to GB for chart
                backgroundColor: pieColors,
                // Store percentage data directly in the dataset for the tooltip
                percentage: pieData.map(d => d.percentage)
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        filter: function (legendItem, chartData) {
                            return true; // Always show all legend items
                        },
                        boxWidth: isMobile ? 10 : 40, // Use 10px box on mobile
                        padding: isMobile ? 8 : 10, // Use 8px padding on
                        font: {
                            size: isMobile ? 11 : undefined // Increase mobile font size by +1
                        }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            // Robustness check: ensure dataset and percentage exist before access
                            if (context.dataset && context.dataset.percentage && context.dataset.percentage[context.dataIndex] !== undefined) {
                                const value = context.raw || 0;
                                const percentage = context.dataset.percentage[context.dataIndex];
                                return `${formatBytes(value * 1073741824)} (${percentage.toFixed(2)}%)`; // Convert GB to bytes
                            }
                            // Fallback to default label if custom data isn't ready
                            return context.label + ': ' + formatBytes(context.raw * 1073741824);
                        }
                    }
                }
            }
        }
    });
}

/**
 * Render the top apps chart
 * @param {Array<Object>} topAppsData - Data for the top apps chart
 */
function renderTopAppsChart(topAppsData) {
    const existingChart = Chart.getChart('topAppsChart');
    if (existingChart) {
        existingChart.destroy();
    }
    const appNames = topAppsData.map(app => app.name);
    const appTotals = topAppsData.map(app => app.total_bytes / 1073741824); // Convert bytes to GB for chart

    // Option 2: Shades of Green
    const backgroundColors = appNames.map((_, i) => `rgba(25, 135, 84, ${1 - (i * 0.05)})`);
    const borderColorsArray = appNames.map((_, i) => `rgba(25, 135, 84, ${1 - (i * 0.05)})`);

    const isMobile = window.matchMedia('(max-width: 768px)').matches; // More robust mobile detection

    const chartOptions = {
        responsive: true,
        maintainAspectRatio: !isMobile, // Maintain aspect ratio on desktop, not on mobile
        indexAxis: 'y',
        plugins: {
            legend: {
                display: false
            },
            title: {
                display: true,
                text: translate('Top Applications/Websites by Traffic')
            },
            tooltip: {
                callbacks: {
                    label: function (context) {
                        let label = context.dataset.label || '';
                        if (label) {
                            label += ': ';
                        }
                        const value = context.raw * 1073741824; // Convert GB back to bytes for formatting
                        const total = context.dataset.data.reduce((sum, val) => sum + val, 0);
                        const percentage = (context.raw / total * 100).toFixed(2);
                        return `${label}${formatBytes(value)} (${percentage}%)`;
                    }
                }
            }
        },
        scales: {
            x: {
                beginAtZero: true,
                title: {
                    display: true,
                    text: 'Traffic (GB)'
                }
            },
            y: {
                beginAtZero: true,
                ticks: {
                    autoSkip: false, // Prevent app names from being cut off
                    font: {
                        size: isMobile ? 9 : 12 // Smaller font on mobile, default on desktop
                    },
                    padding: isMobile ? 8 : 0 // Add padding on mobile, no padding on desktop
                }
            }
        }
    };

    window.topAppsChart = new Chart(document.getElementById('topAppsChart').getContext('2d'), {
        type: 'bar',
        data: {
            labels: appNames,
            datasets: [{
                label: 'Total Traffic',
                data: appTotals,
                backgroundColor: backgroundColors,
                borderColor: borderColorsArray,
                borderWidth: 1
            }]
        },
        options: chartOptions
    });
}

// Export functions for use in other modules
export { renderCharts, renderTopAppsChart };