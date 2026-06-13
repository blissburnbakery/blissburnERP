/* ==========================================================================
   BLISSBURN ERP - BLUETOOTH PRINT ANIMATION (print-fx.js)
   Plays a short "document beams from phone to portable printer, receipt
   rolls out" scene, then triggers the real window.print().
   Used by the Print buttons on the receipt & invoice dialogs.
   Rendered as a <dialog> so it stacks above the already-open modal.
   ========================================================================== */
(function () {
    'use strict';

    let fxDialog = null;
    let finishTimer = null;
    let captionTimer = null;

    const SCENE_SVG = `
    <svg viewBox="0 0 520 250" class="pfx-scene" aria-hidden="true">
        <!-- Bluetooth link path (phone -> printer) -->
        <path class="pfx-link" d="M150 130 C 215 70, 285 70, 350 128" fill="none"/>

        <!-- Signal waves from the phone -->
        <g class="pfx-waves">
            <circle class="pfx-wave" cx="152" cy="124" r="14"/>
            <circle class="pfx-wave pfx-wave-2" cx="152" cy="124" r="14"/>
        </g>

        <!-- Phone -->
        <g transform="translate(55,50)">
            <rect x="0" y="0" width="92" height="156" rx="16" class="pfx-device"/>
            <rect x="6" y="8" width="80" height="140" rx="10" class="pfx-screen"/>
            <rect x="34" y="2" width="24" height="3.5" rx="1.75" class="pfx-notch"/>
            <!-- mini receipt preview on screen -->
            <rect x="18" y="22" width="56" height="84" rx="4" class="pfx-mini-receipt"/>
            <rect x="26" y="32" width="40" height="4" rx="2" class="pfx-ink-strong"/>
            <rect x="26" y="44" width="40" height="3" rx="1.5" class="pfx-ink"/>
            <rect x="26" y="52" width="32" height="3" rx="1.5" class="pfx-ink"/>
            <rect x="26" y="60" width="36" height="3" rx="1.5" class="pfx-ink"/>
            <rect x="26" y="68" width="28" height="3" rx="1.5" class="pfx-ink"/>
            <rect x="26" y="82" width="40" height="4" rx="2" class="pfx-ink-strong"/>
            <rect x="26" y="94" width="24" height="3" rx="1.5" class="pfx-ink"/>
        </g>

        <!-- Flying document -->
        <g class="pfx-doc">
            <rect x="0" y="0" width="24" height="30" rx="4" class="pfx-doc-body"/>
            <rect x="5" y="7" width="14" height="3" rx="1.5" class="pfx-ink"/>
            <rect x="5" y="14" width="11" height="3" rx="1.5" class="pfx-ink"/>
            <rect x="5" y="21" width="14" height="3" rx="1.5" class="pfx-ink-strong"/>
        </g>

        <!-- Printer (paper drawn first so it emerges from behind the body).
             Position lives on the outer group: a CSS transform animation on the
             inner group would override an attribute transform set there. -->
        <g transform="translate(330,96)">
            <g class="pfx-printer">
            <clipPath id="pfxPaperClip"><rect x="20" y="-140" width="120" height="262"/></clipPath>
            <g clip-path="url(#pfxPaperClip)">
            <g class="pfx-paper">
                <rect x="30" y="26" width="92" height="150" rx="3" class="pfx-paper-body"/>
                <rect x="42" y="38" width="66" height="5" rx="2.5" class="pfx-ink-strong"/>
                <rect x="42" y="52" width="66" height="4" rx="2" class="pfx-ink"/>
                <rect x="42" y="62" width="50" height="4" rx="2" class="pfx-ink"/>
                <rect x="42" y="72" width="58" height="4" rx="2" class="pfx-ink"/>
                <rect x="42" y="82" width="44" height="4" rx="2" class="pfx-ink"/>
                <rect x="42" y="96" width="66" height="5" rx="2.5" class="pfx-ink-strong"/>
            </g>
            </g>
            <rect x="0" y="30" width="152" height="92" rx="18" class="pfx-printer-body"/>
            <rect x="0" y="30" width="152" height="34" rx="18" class="pfx-printer-top"/>
            <rect x="24" y="24" width="104" height="11" rx="5.5" class="pfx-slot"/>
            <circle cx="132" cy="86" r="5" class="pfx-led"/>
            <path d="M22 80 L34 92 L28 97 L28 75 L34 80 L22 92" class="pfx-bt"/>
            </g>
        </g>
    </svg>`;

    function buildDialog() {
        fxDialog = document.createElement('dialog');
        fxDialog.id = 'printFxDialog';
        fxDialog.innerHTML = `
            <div class="pfx-card">
                ${SCENE_SVG}
                <p class="pfx-caption" aria-live="polite">Sending to printer…</p>
                <p class="pfx-hint">Tap anywhere to skip</p>
            </div>`;
        document.body.appendChild(fxDialog);

        fxDialog.addEventListener('click', finishNow);
        fxDialog.addEventListener('cancel', (e) => {
            e.preventDefault();
            finishNow();
        });
    }

    function cleanup() {
        clearTimeout(finishTimer);
        clearTimeout(captionTimer);
        if (fxDialog && fxDialog.open) fxDialog.close();
        if (fxDialog) fxDialog.classList.remove('pfx-play');
    }

    function finishNow() {
        cleanup();
        // Give the browser a frame to repaint without the overlay, then print
        setTimeout(() => window.print(), 80);
    }

    window.printWithAnimation = function (docKind) {
        const kind = docKind === 'invoice' ? 'invoice' : 'receipt';

        // Accessibility: reduced motion users go straight to the print dialog
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            window.print();
            return;
        }

        if (!fxDialog) buildDialog();

        const caption = fxDialog.querySelector('.pfx-caption');
        caption.textContent = `Sending ${kind} to printer…`;

        fxDialog.showModal();

        // Restart all CSS animations from zero
        fxDialog.classList.remove('pfx-play');
        void fxDialog.offsetWidth;
        fxDialog.classList.add('pfx-play');

        captionTimer = setTimeout(() => {
            caption.textContent = `Printing ${kind}…`;
        }, 1150);
        finishTimer = setTimeout(finishNow, 2500);
    };
})();
