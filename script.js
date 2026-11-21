/**
 * QUEUE24 — Core Interactive Engine
 * Handles navigation, interactive hero mockup, live queue simulator,
 * timeline stepping, dashboard actions, industry deep-dives, and modals.
 */

document.addEventListener('DOMContentLoaded', () => {
  initNavbar();
  initHeroInteractions();
  initIndustryModals();
  initDashboardInteractions();
  initTimeline();
  initModals();
  initSimulator();
  initAppDownloads();
});

// ==========================================================================
// 1. NAVBAR & MOBILE DRAWER
// ==========================================================================
function initNavbar() {
  const header = document.querySelector('.site-header');
  const toggle = document.querySelector('.mobile-toggle');
  const drawer = document.querySelector('.mobile-drawer');

  // Sticky header scroll listener
  window.addEventListener('scroll', () => {
    if (window.scrollY > 20) {
      header.classList.add('scrolled');
    } else {
      header.classList.remove('scrolled');
    }
  }, { passive: true });

  // Mobile menu toggle
  if (toggle && drawer) {
    toggle.addEventListener('click', () => {
      const isOpen = drawer.classList.contains('open');
      if (isOpen) {
        drawer.classList.remove('open');
        toggle.classList.remove('active');
        toggle.setAttribute('aria-expanded', 'false');
      } else {
        drawer.classList.add('open');
        toggle.classList.add('active');
        toggle.setAttribute('aria-expanded', 'true');
      }
    });

    // Close mobile menu on link click
    drawer.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        drawer.classList.remove('open');
        toggle.classList.remove('active');
        toggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  // Smooth scroll helper for internal anchors
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
      const targetId = this.getAttribute('href');
      if (targetId && targetId !== '#') {
        const targetEl = document.querySelector(targetId);
        if (targetEl) {
          e.preventDefault();
          targetEl.scrollIntoView({ behavior: 'smooth' });
        }
      }
    });
  });
}

// ==========================================================================
// 2. HERO PHONE INTERACTIONS
// ==========================================================================
function initHeroInteractions() {
  const pills = document.querySelectorAll('.channel-pill');
  pills.forEach(pill => {
    pill.addEventListener('click', () => {
      pills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      const channel = pill.getAttribute('data-channel') || 'Channel';
      showToast(`Notification channel set to ${channel}`);
    });
  });

  const viewDetailsBtn = document.querySelector('.phone-view-details');
  if (viewDetailsBtn) {
    viewDetailsBtn.addEventListener('click', (e) => {
      e.preventDefault();
      openModal('simulator-modal');
    });
  }
}

// ==========================================================================
// 3. INDUSTRY CARDS & MODAL DETAILS
// ==========================================================================
const industryData = {
  general: {
    title: 'General & Family Practice',
    subtitle: 'Walk-in consultations, follow-ups & prescription reviews',
    tag: 'Healthcare',
    description: 'Keep patients and family members informed with live token tracking on their own phones. Patients can wait comfortably in open lounges or outside instead of overcrowded indoor waiting rooms.',
    features: [
      'Multi-doctor OPD consultation token queues',
      'Emergency escalation and priority patient scheduling',
      'Confidential token display with live wait estimates',
      'Estimated consultation wait time algorithm based on doctor pace'
    ]
  },
  dental: {
    title: 'Dental & Specialty Clinics',
    subtitle: 'Procedure tracking, appointment check-ins & sanitized bays',
    tag: 'Dental & Specialized',
    description: 'Provide total visibility into dental operatory readiness. Patients check in digitally and receive recall alerts exactly when the chair is prepped and sterilized.',
    features: [
      'Operatory chair readiness tracking and doctor alerts',
      'Procedure-specific time scheduling and delay prevention',
      'Sanitized bay turnover notifications',
      'Direct SMS / WhatsApp recall when the treatment room is ready'
    ]
  },
  diagnostic: {
    title: 'Diagnostic & Pathology Labs',
    subtitle: 'Fasting blood tests, ultrasound tokens & digital report pickup',
    tag: 'Diagnostics & Pathology',
    description: 'Eliminate chaotic morning blood collection crowds. Patients take a digital token on arrival and receive updates for sample collection and report delivery.',
    features: [
      'Priority routing for fasting patients and senior citizens',
      'Sample collection room assignment tokens',
      'Automated SMS alert when lab test reports are ready',
      'Barcode and MRN token matching integration'
    ]
  },
  pediatric: {
    title: 'Pediatric & Maternity Care',
    subtitle: 'Stress-free waiting for parents with calm priority queues',
    tag: 'Pediatrics & Maternity',
    description: 'Parents with sick infants and toddlers avoid stressful crowded waiting rooms. Families wait in fresh-air gardens or their vehicles until the doctor is ready.',
    features: [
      'Infant priority scheduling and vaccination tracks',
      'Family alert dispatch so children wait in low-stress environments',
      'Doctor delay buffer to prevent crying room build-ups',
      'Dedicated nurse immunization station routing'
    ]
  }
};

function initIndustryModals() {
  document.querySelectorAll('.industry-card').forEach(card => {
    card.addEventListener('click', () => {
      const type = card.getAttribute('data-industry');
      if (type && industryData[type]) {
        populateIndustryModal(industryData[type]);
        openModal('industry-modal');
      }
    });
  });
}

function populateIndustryModal(data) {
  const modal = document.getElementById('industry-modal');
  if (!modal) return;
  modal.querySelector('.industry-modal-title').textContent = data.title;
  modal.querySelector('.industry-modal-tag').textContent = data.tag;
  modal.querySelector('.industry-modal-subtitle').textContent = data.subtitle;
  modal.querySelector('.industry-modal-desc').textContent = data.description;
  
  const list = modal.querySelector('.industry-features-list');
  list.innerHTML = '';
  data.features.forEach(feat => {
    const li = document.createElement('li');
    li.textContent = feat;
    list.appendChild(li);
  });
}

// ==========================================================================
// 4. DARK DASHBOARD SHOWCASE INTERACTIONS
// ==========================================================================
function initDashboardInteractions() {
  // Sidebar item selection
  const navItems = document.querySelectorAll('.dash-nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      navItems.forEach(n => n.classList.remove('active'));
      item.classList.add('active');
      const tabName = item.textContent.trim();
      showToast(`Switched view to ${tabName}`);
    });
  });

  // Action buttons in the dashboard table (Call, Notify, Serve)
  document.querySelectorAll('.dash-table .action-btn-small').forEach(btn => {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      const row = this.closest('tr');
      const token = row.querySelector('.token-tag').textContent;
      const name = row.children[1].textContent;
      const action = this.getAttribute('data-action') || 'action';

      if (action === 'call') {
        this.textContent = 'Calling...';
        this.style.background = '#1FA36E';
        showToast(`Calling ${name} (${token}) via SMS/WhatsApp...`);
        setTimeout(() => {
          this.textContent = 'Called ✓';
          this.style.background = '#0B5E41';
        }, 800);
      } else if (action === 'notify') {
        this.textContent = 'Sent ✓';
        this.style.background = '#108A49';
        showToast(`Reminder sent to ${name} (${token})`);
      }
    });
  });

  // Explore features button
  const exploreBtn = document.getElementById('btn-explore-features');
  if (exploreBtn) {
    exploreBtn.addEventListener('click', () => {
      openModal('features-modal');
    });
  }

  // QR Code simulation button in companion phone
  const qrBox = document.querySelector('.qr-code-box');
  if (qrBox) {
    qrBox.style.cursor = 'pointer';
    qrBox.addEventListener('click', () => {
      openModal('simulator-modal');
    });
  }
}

// ==========================================================================
// 5. HOW IT WORKS HORIZONTAL TIMELINE
// ==========================================================================
const timelineDetails = [
  {
    step: '01',
    title: 'Set up your location in 2 minutes',
    desc: 'Enter your business name, set operating hours, choose your notification channels (SMS or WhatsApp), and configure table or counter capacities. No credit card or hardware installation needed.',
    badge: 'Quick Onboarding'
  },
  {
    step: '02',
    title: 'Customers join with zero app downloads',
    desc: 'Customers scan a printed QR stand at your entrance, tap a web link, or message your WhatsApp business number. They instantly receive their digital ticket and live wait time tracker.',
    badge: 'Zero Friction'
  },
  {
    step: '03',
    title: 'Staff manage the queue with one tap',
    desc: 'Your staff view the live queue on any tablet, laptop, or phone. One tap calls the next customer, holds a party, or sends automatic preparation alerts without shouting names.',
    badge: 'Real-Time Control'
  },
  {
    step: '04',
    title: 'Delightful customer experience & repeat visits',
    desc: 'Customers wait comfortably wherever they wish — browsing nearby shops or sipping coffee. They arrive right as their turn begins, leaving 5-star reviews instead of frustrated complaints.',
    badge: 'Proven Loyalty'
  }
];

function initTimeline() {
  const steps = document.querySelectorAll('.timeline-step');
  if (!steps.length) return;

  steps.forEach((stepEl) => {
    stepEl.addEventListener('click', () => {
      steps.forEach(s => s.classList.remove('active'));
      stepEl.classList.add('active');
    });
  });
}

// ==========================================================================
// 6. MODALS MANAGEMENT
// ==========================================================================
function initModals() {
  // Triggers for Get Started
  document.querySelectorAll('.trigger-get-started').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      openModal('get-started-modal');
    });
  });

  // Triggers for Login
  document.querySelectorAll('.trigger-login').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      openModal('login-modal');
    });
  });

  // Triggers for Pricing
  document.querySelectorAll('.trigger-pricing').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      openModal('pricing-modal');
    });
  });

  // Triggers for Simulator / See How It Works
  document.querySelectorAll('.trigger-simulator').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      openModal('simulator-modal');
    });
  });

  // Triggers for Contact
  document.querySelectorAll('.trigger-contact').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      openModal('contact-modal');
    });
  });

  // Triggers for Resources / Help
  document.querySelectorAll('.trigger-resources').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      openModal('features-modal');
    });
  });

  // Triggers for App Download Modal
  document.querySelectorAll('.trigger-download-app').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      openModal('download-app-modal');
    });
  });

  // Close buttons inside modals
  document.querySelectorAll('.modal-close-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      const modal = this.closest('.modal-overlay');
      if (modal) closeModal(modal.id);
    });
  });

  // Close on backdrop click
  document.querySelectorAll('.modal-overlay').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeModal(modal.id);
      }
    });
  });

  // Close on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const openModalEl = document.querySelector('.modal-overlay.open');
      if (openModalEl) {
        closeModal(openModalEl.id);
      }
    }
  });

  // Forms submission handling
  initFormSubmissions();
}

function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
    const firstInput = modal.querySelector('input, select, textarea');
    if (firstInput) setTimeout(() => firstInput.focus(), 100);
  }
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('open');
    document.body.style.overflow = '';
  }
}

function initFormSubmissions() {
  // Get Started Form
  const getStartedForm = document.getElementById('get-started-form');
  if (getStartedForm) {
    getStartedForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const bName = getStartedForm.querySelector('[name="businessName"]').value;
      closeModal('get-started-modal');
      showToast(`🎉 Welcome to Queue24, Dr. / ${bName || 'Clinic'}! Your free clinic queue account is activated.`);
    });
  }

  // Login Form
  const loginForm = document.getElementById('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const email = loginForm.querySelector('[name="email"]').value;
      closeModal('login-modal');
      showToast(`Logged in successfully as ${email || 'Staff'}`);
    });
  }

  // Contact Form
  const contactForm = document.getElementById('contact-form');
  if (contactForm) {
    contactForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = contactForm.querySelector('[name="senderName"]').value;
      closeModal('contact-modal');
      showToast(`Thank you ${name}! Our medical solutions team will get back to you shortly.`);
    });
  }

  // Role toggle buttons in Login Modal
  const roleButtons = document.querySelectorAll('.role-toggle-btn');
  roleButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      roleButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
}

// ==========================================================================
// 7. INTERACTIVE QUEUE SIMULATOR (Live Demo)
// ==========================================================================
let simulatedQueueNumber = 16;
let simulatedWaitTime = 14;

function initSimulator() {
  const simForm = document.getElementById('sim-join-form');
  const simResult = document.getElementById('sim-result-card');
  const simTokenEl = document.getElementById('sim-token-number');
  const simWaitEl = document.getElementById('sim-wait-time');
  const simNameEl = document.getElementById('sim-guest-name');
  const simSendAlertBtn = document.getElementById('sim-send-alert-btn');

  if (simForm) {
    simForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = document.getElementById('sim-input-name').value || 'Patient';
      simulatedQueueNumber++;
      simulatedWaitTime = Math.max(10, simulatedWaitTime + 4);

      if (simTokenEl) simTokenEl.textContent = `#${simulatedQueueNumber}`;
      if (simWaitEl) simWaitEl.textContent = `~${simulatedWaitTime} minutes`;
      if (simNameEl) simNameEl.textContent = name;

      simForm.style.display = 'none';
      if (simResult) simResult.style.display = 'block';

      showToast(`Patient Token #${simulatedQueueNumber} created for ${name}!`);
    });
  }

  if (simSendAlertBtn) {
    simSendAlertBtn.addEventListener('click', () => {
      showToast('📲 Simulated WhatsApp alert sent: "Dr. Rajesh Mehta is ready in OPD Room 1!"');
    });
  }

  const simResetBtn = document.getElementById('sim-reset-btn');
  if (simResetBtn) {
    simResetBtn.addEventListener('click', () => {
      if (simForm) simForm.style.display = 'block';
      if (simResult) simResult.style.display = 'none';
    });
  }
}

// ==========================================================================
// 8. TOAST NOTIFICATION UTILITY
// ==========================================================================
let toastTimeout;
function showToast(message) {
  let toast = document.querySelector('.toast-notice');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast-notice';
    toast.innerHTML = `<span class="toast-icon">✓</span><span class="toast-text"></span>`;
    document.body.appendChild(toast);
  }

  const textEl = toast.querySelector('.toast-text');
  if (textEl) textEl.textContent = message;

  toast.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.remove('show');
  }, 3800);
}

// ==========================================================================
// 9. APP DOWNLOAD SYSTEM (App Store & Google Play Integration)
// ==========================================================================
function initAppDownloads() {
  const IOS_URL = 'https://apps.apple.com/in/app/queue24-clinic-queue-app/id6813539619';
  const ANDROID_URL = 'https://play.google.com/store/apps/details?id=com.atzerocost.queue24';

  const ua = navigator.userAgent || navigator.vendor || window.opera || '';
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /android/i.test(ua);

  // Update smart device hint in Hero
  const hintEl = document.getElementById('smart-device-text');
  const heroAppStoreBadge = document.getElementById('hero-badge-appstore');
  const heroPlayStoreBadge = document.getElementById('hero-badge-playstore');

  if (isIOS) {
    if (hintEl) hintEl.innerHTML = '<strong>Apple iOS detected:</strong> Tap button above to open Apple App Store';
    if (heroAppStoreBadge) {
      heroAppStoreBadge.style.boxShadow = '0 0 0 2.5px #1FA36E, 0 8px 24px rgba(31, 163, 110, 0.4)';
      const pill = heroAppStoreBadge.querySelector('.app-badge-pill');
      if (pill) pill.textContent = '✓ Your Device';
    }
  } else if (isAndroid) {
    if (hintEl) hintEl.innerHTML = '<strong>Android device detected:</strong> Tap button above to open Google Play Store';
    if (heroPlayStoreBadge) {
      heroPlayStoreBadge.style.boxShadow = '0 0 0 2.5px #1FA36E, 0 8px 24px rgba(31, 163, 110, 0.4)';
      const pill = heroPlayStoreBadge.querySelector('.app-badge-pill');
      if (pill) pill.textContent = '✓ Your Device';
    }
  } else {
    if (hintEl) hintEl.textContent = 'Available for iPhone, iPad & Android • 100% Free to Download';
  }

  // Universal Smart Download buttons (Nav, Mobile Drawer, and In-mockup link)
  document.querySelectorAll('.smart-download-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      if (isIOS) {
        showToast('Opening Queue24 on Apple App Store...');
        setTimeout(() => {
          window.open(IOS_URL, '_blank');
        }, 350);
      } else if (isAndroid) {
        showToast('Opening Queue24 on Google Play Store...');
        setTimeout(() => {
          window.open(ANDROID_URL, '_blank');
        }, 350);
      } else {
        // Desktop / Laptop: open the modal with both stores & QR codes
        openModal('download-app-modal');
      }
    });
  });

  // Direct App Store link clicks
  document.querySelectorAll('.app-badge-apple').forEach(link => {
    link.addEventListener('click', () => {
      showToast('Opening Queue24 on Apple App Store...');
    });
  });

  // Direct Google Play link clicks
  document.querySelectorAll('.app-badge-google').forEach(link => {
    link.addEventListener('click', () => {
      showToast('Opening Queue24 on Google Play Store...');
    });
  });

  // QR Code tab switcher in dedicated section
  const qrTabs = document.querySelectorAll('.qr-tab-btn');
  const iosQrWrapper = document.getElementById('qr-ios-wrapper');
  const androidQrWrapper = document.getElementById('qr-android-wrapper');
  const qrCaption = document.getElementById('qr-caption-text');

  // If user is on Android, default the tab to Android QR
  if (isAndroid && androidQrWrapper && iosQrWrapper) {
    qrTabs.forEach(t => t.classList.remove('active'));
    const androidTab = document.querySelector('.qr-tab-btn[data-target="qr-android"]');
    if (androidTab) androidTab.classList.add('active');
    iosQrWrapper.style.display = 'none';
    androidQrWrapper.style.display = 'flex';
    if (qrCaption) qrCaption.textContent = 'Scan with Android camera to download from Google Play';
  }

  qrTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      qrTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.getAttribute('data-target');
      if (target === 'qr-ios') {
        if (iosQrWrapper) iosQrWrapper.style.display = 'flex';
        if (androidQrWrapper) androidQrWrapper.style.display = 'none';
        if (qrCaption) qrCaption.textContent = 'Scan with iPhone / iPad camera to download from App Store';
      } else {
        if (iosQrWrapper) iosQrWrapper.style.display = 'none';
        if (androidQrWrapper) androidQrWrapper.style.display = 'flex';
        if (qrCaption) qrCaption.textContent = 'Scan with Android camera to download from Google Play';
      }
    });
  });
}

