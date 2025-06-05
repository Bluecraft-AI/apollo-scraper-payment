// script.js

document.addEventListener('DOMContentLoaded', function() {
  // Initialize collapsible sections
  const collapsibles = document.querySelectorAll('.collapsible');
  
  // Function to toggle collapsible sections
  function toggleCollapsible(section) {
    section.classList.toggle('active');
  }
  
  // Add click event listeners to all collapsible headers
  collapsibles.forEach(section => {
    const header = section.querySelector('.collapsible-header');
    header.addEventListener('click', () => {
      toggleCollapsible(section);
    });
  });
  
  // Open the first section by default
  if (collapsibles.length > 0) {
    toggleCollapsible(collapsibles[0]);
  }
  
  // Handle navigation links
  const navLinks = document.querySelectorAll('nav a, .quick-links a');
  
  navLinks.forEach(link => {
    link.addEventListener('click', function(e) {
      e.preventDefault();
      
      // Get the target section id from the href
      let href = this.getAttribute('href');
      let targetId;
      
      // Handle both formats: "#section-name" and "index.html#section-name"
      if (href.includes('#')) {
        targetId = href.substring(href.indexOf('#') + 1);
      } else {
        return; // No anchor, do nothing
      }
      
      // First try to find the element directly
      let targetElement = document.getElementById(targetId);
      let parentSection = null;
      
      // If direct element not found, search within all sections
      if (!targetElement) {
        const allSections = document.querySelectorAll('.collapsible');
        
        // Search through all sections for the target ID
        for (let section of allSections) {
          // Check if section contains an element with the target ID
          const nestedElement = section.querySelector('#' + targetId);
          
          // Also check for elements that might be created dynamically
          // by looking at the innerHTML for id="targetId"
          if (nestedElement || section.innerHTML.includes('id="' + targetId + '"')) {
            parentSection = section;
            
            // If we found a nested element, use that as our target
            if (nestedElement) {
              targetElement = nestedElement;
            }
            break;
          }
        }
      } else {
        // If direct element was found, find its parent section
        let current = targetElement;
        while (current && !current.classList.contains('collapsible')) {
          current = current.parentElement;
        }
        if (current && current.classList.contains('collapsible')) {
          parentSection = current;
        }
      }
      
      // Determine if this is a subsection or main section
      // If target is not the same as parent section, it's a subsection
      const isSubsection = targetElement && parentSection && targetElement !== parentSection;
      
      // Set padding based on whether it's a subsection or main section
      const topPadding = isSubsection ? 10 : 20;
      
      // If we found a parent section, open it without scrolling yet
      if (parentSection) {
        // Close all sections first
        collapsibles.forEach(section => {
          section.classList.remove('active');
        });
        
        // Open the parent section
        parentSection.classList.add('active');
        
        // Use MutationObserver to detect when the section content becomes visible
        const observer = new MutationObserver((mutations, obs) => {
          // Look for mutations that might indicate the section is fully expanded
          const contentVisible = mutations.some(mutation => {
            return mutation.target.style.display === 'block' || 
                  (mutation.attributeName === 'style' && 
                   mutation.target.style.display !== 'none');
          });
          
          if (contentVisible || mutations.length > 0) {
            // Disconnect the observer once we've detected changes
            obs.disconnect();
            
            // Calculate the final scroll position directly
            // If we have a specific target element, scroll directly to it
            if (targetElement && targetElement !== parentSection) {
              // Wait for DOM to fully update before calculating position
              setTimeout(() => {
                // Get the most up-to-date position
                const updatedPosition = targetElement.getBoundingClientRect();
                const scrollTop = window.pageYOffset + updatedPosition.top - topPadding;
                
                // Single smooth scroll to the final destination
                window.scrollTo({
                  top: scrollTop,
                  left: 0,
                  behavior: 'smooth'
                });
              }, 100);
            } else {
              // If no specific target, scroll to the parent section
              window.scrollTo({
                top: parentSection.offsetTop - topPadding,
                left: 0,
                behavior: 'smooth'
              });
            }
          }
        });
        
        // Start observing the parent section for attribute and child changes
        observer.observe(parentSection, { 
          attributes: true, 
          childList: true, 
          subtree: true,
          attributeFilter: ['style', 'class']
        });
        
        // Set a fallback timeout in case the observer doesn't trigger
        setTimeout(() => {
          observer.disconnect();
          
          // If we have a specific target element, scroll directly to it
          if (targetElement && targetElement !== parentSection) {
            // Get the most up-to-date position
            const updatedPosition = targetElement.getBoundingClientRect();
            const scrollTop = window.pageYOffset + updatedPosition.top - topPadding;
            
            // Single smooth scroll to the final destination
            window.scrollTo({
              top: scrollTop,
              left: 0,
              behavior: 'smooth'
            });
          } else {
            // If no specific target, scroll to the parent section
            window.scrollTo({
              top: parentSection.offsetTop - topPadding,
              left: 0,
              behavior: 'smooth'
            });
          }
        }, 300);
      } else if (targetElement) {
        // If we found the target element but no parent section, just scroll to it
        window.scrollTo({
          top: targetElement.offsetTop - topPadding,
          left: 0,
          behavior: 'smooth'
        });
      }
    });
  });
  
  // Make the sidebar fixed on scroll for desktop
  const sidebar = document.querySelector('.sidebar');
  const content = document.querySelector('.content');
  
  // Only apply fixed sidebar on larger screens
  if (window.innerWidth > 768) {
    window.addEventListener('scroll', function() {
      if (window.scrollY > 0) {
        sidebar.style.top = '0';
      } else {
        sidebar.style.top = '0';
      }
    });
  }
  
  // Handle responsive navigation
  function handleResponsive() {
    if (window.innerWidth <= 768) {
      sidebar.style.position = 'relative';
      content.style.marginLeft = '0';
    } else {
      sidebar.style.position = 'fixed';
      content.style.marginLeft = getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width');
    }
  }
  
  // Initial call and add resize listener
  handleResponsive();
  window.addEventListener('resize', handleResponsive);
});
