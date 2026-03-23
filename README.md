# RF Design Lab

A comprehensive, web-based interactive tool for Radio Frequency (RF) parameters calculation, simulation, and learning.

## Overview

The RF Design Lab is a single-page HTML application designed to help engineers, students, and hobbyists understand and calculate various RF parameters. It features real-time visualizations, interactive sliders, and AI-assisted diagnostics to aid in the learning and design process.

## Features

- **Impedance Lab**: Calculate and visualize reflection coefficient (Γ), VSWR, Return Loss, Mismatch Loss, and Power Delivered based on load parameters and reference impedance. Features an Interactive Impedance Phasor and AI diagnosis for mismatch fixes.
- **Frequency Sweep**: Simulate Series RL, RC, LC, and RLC component models over different frequency ranges (up to 10 GHz) and visualize VSWR, Return Loss, and |Γ| against Frequency.
- **Wave Simulator**: Visualize transmission line forward, reflected, and standing waves dynamically with adjustable reflection magnitude, frequency, and phase shift.
- **Matching Circuit**: Compute L-Network (Low-Pass and High-Pass) matching circuits based on load parameters and reference impedance.
- **Smith Chart**: An interactive Smith Chart visualization for plotting normalized impedance points and calculating associated metrics.
- **Learn Mode**: Educational reference material tailored for beginners, intermediate, and advanced users, featuring quick references and crucial formulas for RF engineering.

## How to Use

1. Clone or download this repository to your local machine.
2. Open the `rf-design-lab.html` file in any modern web browser (e.g., Chrome, Firefox, Edge). 
3. No installation or build steps are required. The application runs entirely in the browser.

## Built With

- **HTML5, Vanilla CSS, and Vanilla JavaScript**: For structure, styling, and interactivity, without heavy frameworks.
- **[Chart.js](https://www.chartjs.org/)**: Used for rendering dynamic graphs and chart visualizations.

## License

This project is intended for educational purposes and RF design exploration.
