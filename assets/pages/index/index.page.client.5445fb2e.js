import{a}from"../../chunk-6b5bd1ab.js";import"../../chunk-2eb5984d.js";d();i();function d(){m("https://platform.twitter.com/widgets.js")}function i(){Array.from(document.getElementById("features").querySelectorAll(".feature.has-learn-more")).forEach(e=>{e.onclick=()=>{u(e)}})}function u(t){const e=t.id;a(e.startsWith("feature-"),{featureId:e});const c=e.slice(8),s="selected",n="learn-more-"+c,o=document.getElementById(n);if(a(o,{learnId:n}),!t.classList.contains(s)){const r=t.parentNode;f(r,"display")==="grid"&&[...r.querySelectorAll(".learn-more"),...r.querySelectorAll(".feature")].forEach(l=>{l.classList.remove(s)})}[t,o].forEach(r=>{r.classList.toggle(s)})}function m(t){a(t.startsWith("https://"));const e=document.createElement("script");e.src=t,e.async=!0,e.setAttribute("charset","utf-8"),document.getElementsByTagName("head")[0].appendChild(e)}function f(t,e){return window.document.defaultView.getComputedStyle(t).getPropertyValue(e)}