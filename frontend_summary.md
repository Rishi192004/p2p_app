# P2P Gossip Visualizer — Frontend Technical Summary

The frontend is a high-performance, interactive simulation dashboard built to visualize the complexities of distributed P2P gossip protocols. It operates entirely in the browser, using a deterministic simulation engine to model network behavior.

## 🏗️ Architecture
The application follows a modular, unidirectional data flow architecture:

1.  **Core Simulation Engine (`gossipEngine.js`)**: A pure JavaScript logic layer that computes graph adjacency, calculates gossip "waves" (propagation steps), and identifies orphaned nodes for self-healing.
2.  **State Orchestrator (`useGossipState.js`)**: A custom React hook that manages the simulation's lifecycle. It handles timing for animations, batches metric updates, and maintains the ground truth for node/edge states.
3.  **Rendering Layer**:
    *   **D3.js integration**: Used for high-performance SVG rendering of the network topology, applying mathematical coordinate systems to place nodes and draw edges.
    *   **React Components**: Modular UI elements (`ControlPanel`, `MetricsDashboard`, `StatusLog`) that react to state changes.

## 🎨 Design & Aesthetics
The UI is designed with a **"Premium Dark Mode"** aesthetic to provide a high-tech, terminal-like feel suitable for technical demonstrations:
*   **Glassmorphism**: Panels use semi-transparent backgrounds with backdrop blurs.
*   **Dynamic Glows**: Nodes and edges use SVG filters (`feGaussianBlur`) to "glow" when active or receiving messages.
*   **Micro-animations**: Smooth CSS and SVG animations for packet movement, status badge pulsing, and log entry transitions.

## 🛠️ Key Functionalities

### 1. Interactive Graph Visualization
*   Renders a 5-node mesh network.
*   **Live Animations**: Shows "packets" (circles) traveling along edges during gossip rounds.
*   **State Indicators**: Visual distinctness for Active, Lit (receiving), and Dead nodes.

### 2. Gossip Simulation Logic
*   **Fanout (k)**: Users can adjust the "k" value to see how it affects network amplification and delivery speed.
*   **Seen-Message Tracking**: Implements a simulation of the `seenMessages` cache to prevent infinite loops and calculate duplicate message drops.

### 3. Real-Time Metrics Dashboard
*   **Live Counters**: Tracks transmissions, delivery rates, and amplification factors.
*   **Performance Tracking**: Calculates throughput (msgs/sec) and average latency based on simulated "hop delays."
*   **Visual Analytics**: Includes an inline SVG sparkline to show latency trends over time.

### 4. Fault Tolerance & Self-Healing
*   **Node Failure**: Removing a node immediately recalculates the adjacency list and updates the network status to "DEGRADED."
*   **Autonomous Healing**: A dedicated routine that identifies nodes disconnected from the "main mesh" and creates new recovery edges to restore full network reachability.

## 🚀 Tech Stack
*   **Vite + React**: For fast development and modern component architecture.
*   **D3.js**: For mathematical SVG manipulation and graph rendering.
*   **Vanilla CSS**: Custom design system with CSS Variables for theme consistency.
