import { Route, Routes } from "react-router-dom";
import { Box } from "@mui/material";
import { TeamActivityLog } from "./pages/TeamActivityLog";

// import Contact from "../src/pages/Contact";

export const App = () => {
  return (
    <Box>
      {/* <Box>
        <Navbar />
      </Box> */}
      <main className="flex-col min-h-screen flex-1 p-6">
        <Routes>
          <Route path="/" element={<TeamActivityLog />} />
        </Routes>
      </main>
      {/* <Box flexGrow={1}>
        <Footer />
      </Box> */}
    </Box>
  );
};
