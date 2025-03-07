/**
 * Logout Handler for FSCS
 * 
 * This file handles the logout functionality
 * It clears the API key cookie and redirects or reloads the page
 */

document.addEventListener('DOMContentLoaded', function () {
    // Find the logout button
    const logoutButton = document.getElementById('logoutButton');

    if (logoutButton) {
        logoutButton.addEventListener('click', function (e) {
            e.preventDefault();

            // Clear the API key cookie
            clearApiKeyFromCookie();

            // Show a brief notification
            const notification = document.createElement('div');
            notification.className = 'status success';
            notification.style.position = 'fixed';
            notification.style.top = '20px';
            notification.style.left = '50%';
            notification.style.transform = 'translateX(-50%)';
            notification.style.zIndex = '9999';
            notification.style.padding = 'var(--space-md) var(--space-lg)';
            notification.innerHTML = '<i class="fas fa-check-circle"></i> Logged out successfully';

            document.body.appendChild(notification);

            // Remove notification after a short delay
            setTimeout(function () {
                // Either reload the current page or redirect to home
                window.location.reload();
            }, 1000);
        });
    }
});