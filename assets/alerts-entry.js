// Keep this small navigation extension independent of the compiled dashboard.
// It does not access portfolio data, authentication or external services.
const installAlertsLink=()=>{
 const header=document.querySelector('#root > header, #root header');
 if(!header||document.getElementById('portfolio-alerts-link'))return;
 const link=document.createElement('a');
 link.id='portfolio-alerts-link';link.href='./alerts.html';link.textContent='Alerts';
 link.title='Alert rules, reports and delivery status';
 link.style.cssText='color:inherit;text-decoration:none;font-size:13px;font-weight:600;padding:7px 11px;border:1px solid #ffffff50;border-radius:8px;white-space:nowrap;';
 const title=header.querySelector('h1');
 if(title?.parentElement)title.parentElement.append(link);else header.prepend(link);
};
installAlertsLink();
new MutationObserver(installAlertsLink).observe(document.getElementById('root'),{childList:true,subtree:true});
