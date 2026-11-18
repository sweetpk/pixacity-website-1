import React from 'react';
import CelShadedCanvas from './components/CelShadedCanvas';

export default function App() {
  return (
    <main className="relative w-full h-dvh overflow-hidden sky-gradient flex flex-col items-center justify-end pb-10 sm:pb-14 [@media(max-height:480px)]:pb-5">
      {/* Subtle diagonal atmospheric sunbeams */}
      <div className="sun-rays" />

      {/* Full-screen 3D Cel-Shaded Sky, Clouds & Centerpiece Logo */}
      <CelShadedCanvas />

      {/* Minimalist Typography Overlay */}
      <div className="relative z-10 pointer-events-none flex flex-col items-center animate-pill-enter">
        <div className="px-6 py-2.5 sm:px-8 sm:py-3 [@media(max-height:480px)]:px-5 [@media(max-height:480px)]:py-2 rounded-full bg-[#ffd500] border-[2.5px] border-[#111111] shadow-[4px_4px_0px_#111111]">
          <h1 className="text-[11px] sm:text-sm [@media(max-height:480px)]:text-[10px] font-extrabold tracking-[0.34em] sm:tracking-[0.38em] text-[#111111] uppercase pl-[0.34em] sm:pl-[0.38em] whitespace-nowrap">
            RETURNING SOON
          </h1>
        </div>
      </div>
    </main>
  );
}
