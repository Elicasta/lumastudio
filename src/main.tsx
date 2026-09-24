import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import { VideoOutputSurface } from "./components/VideoOutputSurface";
import "./app/styles.css";
import "./app/operator-ui.css";
import "./luma-foundation.css";

const surface = new URLSearchParams(window.location.search).get("surface");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {surface === "video-output" ? <VideoOutputSurface /> : <App />}
  </React.StrictMode>
);
