FROM browserless/chrome:latest

# Use root user
USER root

# Set up env variables
ENV DISPLAY=:99
ENV CHROME_EXECUTABLE_PATH=/usr/bin/google-chrome

# Set working directory
WORKDIR /root/app
COPY . .

# Install npm packages
RUN npm install

# Command to run the script
ENTRYPOINT ["bash", "start.sh"]
