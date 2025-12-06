import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ClerkProvider, SignedIn, SignedOut, RedirectToSignIn } from '@clerk/clerk-react';
// import { ClerkProvider, SignedIn, SignedOut, RedirectToSignIn } from './MockClerk';

// --- Import Your Components ---
import LandingPage from './LandingPage';
import Dashboard from './Dashboard';
import Editor from './Editor';

// --- Clerk Configuration ---
// Make sure this is set in your .env file
const clerkPubKey = process.env.REACT_APP_CLERK_PUBLISHABLE_KEY;

function App() {
  return (
    <ClerkProvider publishableKey={clerkPubKey}>
      <BrowserRouter>
        <Routes>
          {/* 1. PUBLIC ROUTE: The Landing Page (Root URL) */}
          <Route path="/" element={<LandingPage />} />

          {/* 2. PROTECTED ROUTE: Dashboard */}
          <Route
            path="/dashboard"
            element={
              <>
                <SignedIn>
                  <Dashboard />
                </SignedIn>
                <SignedOut>
                  <RedirectToSignIn />
                </SignedOut>
              </>
            }
          />

          {/* 3. PROTECTED ROUTE: Editor */}
          <Route
            path="/editor/:id"
            element={
              <>
                <SignedIn>
                  <Editor />
                </SignedIn>
                <SignedOut>
                  <RedirectToSignIn />
                </SignedOut>
              </>
            }
          />

          {/* 4. Clerk Auth Routes (Redirects) */}
          <Route path="/sign-in/*" element={<RedirectToSignIn />} />
          <Route path="/sign-up/*" element={<RedirectToSignIn />} />

          {/* 5. Catch-All: Redirect unknown URLs to Landing Page */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ClerkProvider>
  );
}

export default App;
