/**
 * API Key Handler for FSCS
 *
 * This file handles saving, retrieving, and using the OpenAI API key
 * It provides UI for collecting the API key and adds it to all API requests
 * Handles user-specific error messages and authentication
 *
 * Multi-user support:
 * - Each API key acts as a unique user identifier
 * - User-specific data and error messages
 * - Isolated user environments
 */

// Cookie utilities for storing and retrieving the API key
function saveApiKeyToCookie(apiKey) {
    // Set cookie to expire in 30 days
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 30);

    // Set the cookie with the API key
    document.cookie = `openai_api_key=${apiKey}; expires=${expiryDate.toUTCString()}; path=/; SameSite=Strict; Secure`;
}

function getApiKeyFromCookie() {
    const cookies = document.cookie.split(';');
    for (let cookie of cookies) {
        const [name, value] = cookie.trim().split('=');
        if (name === 'openai_api_key') {
            return value;
        }
    }
    return null;
}

function clearApiKeyFromCookie() {
    document.cookie = "openai_api_key=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; SameSite=Strict; Secure";
}

// Function to add API key to request headers
function addApiKeyToRequest(options = {}) {
    const apiKey = getApiKeyFromCookie();

    if (!apiKey) {
        throw new Error('No API key found. Please enter your OpenAI API key.');
    }

    // Create new options object with default values if none provided
    // Set both uppercase and lowercase versions of the header to ensure compatibility
    const requestOptions = {
        ...options,
        headers: {
            ...(options.headers || {}),
            'X-OpenAI-API-Key': apiKey,
            'x-openai-api-key': apiKey  // Add lowercase version for compatibility
        }
    };

    return requestOptions;
}

// Helper function to handle API errors
async function handleApiResponse(response) {
    if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = 'An error occurred with the request.';

        try {
            // Try to parse as JSON
            const errorJson = JSON.parse(errorText);
            errorMessage = errorJson.message || errorJson.error || errorText;

            // Handle authentication errors
            if (response.status === 401) {
                clearApiKeyFromCookie();
                createApiKeyModal('Your API key is invalid or has expired. Please enter a valid OpenAI API key.');
                throw new Error('Authentication failed. Please enter a valid API key.');
            }
        } catch (e) {
            // If not JSON, use the error text
            if (response.status === 401) {
                clearApiKeyFromCookie();
                createApiKeyModal('Your API key is invalid or has expired. Please enter a valid OpenAI API key.');
                throw new Error('Authentication failed. Please enter a valid API key.');
            }
        }

        throw new Error(errorMessage);
    }

    return response;
}

// Create and manage the API key modal
function createApiKeyModal(errorMessage = null) {
    // Remove existing modal if present
    const existingModal = document.getElementById('apiKeyModal');
    if (existingModal) {
        document.body.removeChild(existingModal);
    }

    // Create modal container with backdrop
    const modal = document.createElement('div');
    modal.id = 'apiKeyModal';
    modal.style.animation = 'fadeIn 0.3s ease';

    // Create the modal content
    const modalContent = document.createElement('div');
    modalContent.style.animation = 'slideIn 0.3s ease';
    modalContent.style.maxWidth = '450px';
    modalContent.style.width = '90%';
    modalContent.style.borderRadius = 'var(--radius-lg)';
    modalContent.style.boxShadow = 'var(--shadow-lg)';
    modalContent.style.backgroundColor = 'var(--card-bg)';
    modalContent.style.padding = 'var(--space-xl)';

    // Add a small icon to the modal
    const modalIcon = document.createElement('div');
    modalIcon.style.marginBottom = 'var(--space-md)';
    modalIcon.style.textAlign = 'center';
    const icon = document.createElement('i');
    icon.className = errorMessage ? 'fas fa-exclamation-circle' : 'fas fa-key';
    icon.style.fontSize = '2.5rem';
    icon.style.color = errorMessage ? 'var(--error-color)' : 'var(--primary-color)';
    modalIcon.appendChild(icon);

    // Add title with appropriate styling
    const modalTitle = document.createElement('h2');
    modalTitle.textContent = errorMessage ? 'API Key Error' : 'API Key Required';
    modalTitle.style.textAlign = 'center';
    modalTitle.style.marginBottom = 'var(--space-md)';
    modalTitle.style.color = errorMessage ? 'var(--error-color)' : 'var(--text-color)';
    modalTitle.style.fontWeight = '600';

    // Add description with styling
    const modalDescription = document.createElement('p');
    modalDescription.innerHTML = errorMessage ||
        'Please enter your OpenAI API key to use this application. Your key will be stored locally in your browser cookies.';
    modalDescription.style.marginBottom = 'var(--space-lg)';
    modalDescription.style.lineHeight = '1.6';
    modalDescription.style.textAlign = 'center';

    if (errorMessage) {
        modalDescription.style.color = 'var(--error-color)';
        modalDescription.style.fontWeight = '500';
        modalDescription.style.backgroundColor = 'rgba(239, 71, 111, 0.05)';
        modalDescription.style.padding = 'var(--space-sm) var(--space-md)';
        modalDescription.style.borderRadius = 'var(--radius-md)';
        modalDescription.style.border = '1px solid rgba(239, 71, 111, 0.1)';
    }

    // Create a form group for the input
    const formGroup = document.createElement('div');
    formGroup.style.marginBottom = 'var(--space-lg)';

    // Add label for input
    const inputLabel = document.createElement('label');
    inputLabel.textContent = 'OpenAI API Key';
    inputLabel.style.display = 'block';
    inputLabel.style.marginBottom = 'var(--space-sm)';
    inputLabel.style.fontWeight = '500';
    formGroup.appendChild(inputLabel);

    // Create an input group with icon
    const inputGroup = document.createElement('div');
    inputGroup.style.position = 'relative';

    // Add key icon inside input
    const inputIcon = document.createElement('div');
    inputIcon.style.position = 'absolute';
    inputIcon.style.left = 'var(--space-md)';
    inputIcon.style.top = '50%';
    inputIcon.style.transform = 'translateY(-50%)';
    inputIcon.style.color = 'var(--text-color-light)';
    inputIcon.innerHTML = '<i class="fas fa-lock"></i>';
    inputGroup.appendChild(inputIcon);

    // Create the input field
    const apiKeyInput = document.createElement('input');
    apiKeyInput.type = 'password';
    apiKeyInput.placeholder = 'sk-...';
    apiKeyInput.style.paddingLeft = 'calc(var(--space-md) * 2 + 1em)'; // Make room for the icon
    apiKeyInput.style.width = '100%';
    apiKeyInput.style.border = errorMessage ? '1px solid var(--error-color)' : '1px solid var(--border-color)';
    apiKeyInput.style.borderRadius = 'var(--radius-md)';
    apiKeyInput.style.padding = 'var(--space-md)';
    apiKeyInput.style.transition = 'all var(--transition-normal)';

    // Add focus styles
    apiKeyInput.addEventListener('focus', function () {
        this.style.outline = 'none';
        this.style.borderColor = 'var(--primary-color)';
        this.style.boxShadow = '0 0 0 3px rgba(67, 97, 238, 0.15)';
    });

    apiKeyInput.addEventListener('blur', function () {
        this.style.boxShadow = 'none';
        if (!errorEl.textContent) {
            this.style.borderColor = 'var(--border-color)';
        }
    });

    inputGroup.appendChild(apiKeyInput);
    formGroup.appendChild(inputGroup);

    // Create error container
    const errorEl = document.createElement('div');
    errorEl.id = 'apiKeyError';
    errorEl.style.color = 'var(--error-color)';
    errorEl.style.fontSize = '0.875rem';
    errorEl.style.marginTop = 'var(--space-sm)';
    errorEl.style.display = 'none';
    formGroup.appendChild(errorEl);

    // Create buttons container
    const buttonsContainer = document.createElement('div');
    buttonsContainer.style.display = 'flex';
    buttonsContainer.style.justifyContent = 'center';

    // Create submit button with icon
    const submitButton = document.createElement('button');
    submitButton.type = 'button';
    submitButton.innerHTML = '<i class="fas fa-check"></i> Submit';
    submitButton.style.minWidth = '120px';
    submitButton.style.backgroundColor = 'var(--primary-color)';
    submitButton.style.color = 'white';
    submitButton.style.border = 'none';
    submitButton.style.borderRadius = 'var(--radius-md)';
    submitButton.style.padding = 'var(--space-md)';
    submitButton.style.cursor = 'pointer';
    submitButton.style.fontWeight = '500';
    submitButton.style.transition = 'all var(--transition-normal)';

    submitButton.addEventListener('mouseover', function () {
        this.style.backgroundColor = 'var(--secondary-color)';
        this.style.transform = 'translateY(-1px)';
    });

    submitButton.addEventListener('mouseout', function () {
        this.style.backgroundColor = 'var(--primary-color)';
        this.style.transform = 'translateY(0)';
    });

    buttonsContainer.appendChild(submitButton);

    // Verify API key format before submission
    function validateApiKey(apiKey) {
        // Check if it follows OpenAI key format (sk-...)
        if (!apiKey.startsWith('sk-') || apiKey.length < 20) {
            return 'Please enter a valid OpenAI API key (starts with sk-)';
        }
        return null;
    }

    // Handle API key submission
    async function submitApiKey() {
        const apiKey = apiKeyInput.value.trim();

        // Clear previous error
        errorEl.style.display = 'none';
        apiKeyInput.style.border = '1px solid var(--border-color)';

        if (!apiKey) {
            errorEl.textContent = 'API key is required';
            errorEl.style.display = 'block';
            apiKeyInput.style.border = '1px solid var(--error-color)';
            return;
        }

        // Validate key format
        const validationError = validateApiKey(apiKey);
        if (validationError) {
            errorEl.textContent = validationError;
            errorEl.style.display = 'block';
            apiKeyInput.style.border = '1px solid var(--error-color)';
            return;
        }

        // Show loading state
        submitButton.disabled = true;
        submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verifying...';
        submitButton.style.backgroundColor = 'var(--text-color-light)';

        try {
            // Save the key
            saveApiKeyToCookie(apiKey);

            // Test the key with a simple API call
            const response = await fetch('/fine-tuning/models', {
                headers: {
                    'X-OpenAI-API-Key': apiKey,
                    'x-openai-api-key': apiKey // Add lowercase version for compatibility
                }
            });

            await handleApiResponse(response);

            // If we get here, the key is valid
            document.body.removeChild(modal);

            // Dispatch event to notify that API key has been provided
            const event = new Event('apiKeyProvided');
            document.dispatchEvent(event);
        } catch (error) {
            errorEl.textContent = error.message || 'Failed to verify API key. Please try again.';
            errorEl.style.display = 'block';
            apiKeyInput.style.border = '1px solid var(--error-color)';
            clearApiKeyFromCookie();

            // Reset button
            submitButton.disabled = false;
            submitButton.innerHTML = '<i class="fas fa-check"></i> Submit';
            submitButton.style.backgroundColor = 'var(--primary-color)';
        }
    }

    submitButton.addEventListener('click', submitApiKey);

    // Allow submitting by pressing Enter
    apiKeyInput.addEventListener('keypress', function (e) {
        if (e.key === 'Enter') {
            submitApiKey();
        }
    });

    // Append elements to modal content
    modalContent.appendChild(modalIcon);
    modalContent.appendChild(modalTitle);
    modalContent.appendChild(modalDescription);
    modalContent.appendChild(formGroup);
    modalContent.appendChild(buttonsContainer);
    modal.appendChild(modalContent);

    // Add modal to document
    document.body.appendChild(modal);

    // Add animation styles
    const style = document.createElement('style');
    style.textContent = `
        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        @keyframes slideIn {
            from { transform: translateY(-20px); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
        }
    `;
    document.head.appendChild(style);

    // Focus on input field
    setTimeout(() => apiKeyInput.focus(), 100);
}

// Check for API key and show modal if needed
function checkApiKeyAndShowModal() {
    const apiKey = getApiKeyFromCookie();
    if (!apiKey) {
        createApiKeyModal();
        return false;
    }
    return true;
}

// Show error message and prompt for new API key
function showApiKeyError(message) {
    clearApiKeyFromCookie();
    createApiKeyModal(message);
    return false;
}