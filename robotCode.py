import time
import Adafruit_PCA9685
import pygame
from pygame.locals import *

# Initialising controller with alternative address (default is 0x40)
pwm = Adafruit_PCA9685.PCA9685(address=0x41)

# Valid min-max-values for channel pulses
minValue = 0.4
maxValue = 2.5
    
# Setting frequence to 50Hz
pwm.set_pwm_freq(50)

# Servo-Variables, set to default value
servoDefaultValue = 1.5
servo0_pos = servoDefaultValue
servo1_pos = servoDefaultValue
servo2_pos = servoDefaultValue
servo3_pos = servoDefaultValue
servo4_pos = servoDefaultValue
servo5_pos = servoDefaultValue

# control variable, changes behaviour of some pressed keys if true
recordMode = False
recordFileName = ""
# When recording the robotarm, this value gets written in the header of the record file and determines how long the arm should wait between steps in seconds when playing the recording
pauseBetweenSteps = 0
# When recording the robotarm, this value gets written in the header of the record file and determines how long the arm should wait between each individual servo movement in seconds when playing the recording
pauseBetweenServos = 0
# Value at which the servo pulses gets inc- and decremented when controlling the arm
steps = 0.01

# Helper function
def set_servo_pulse(channel, pulse):
    pulse_length = 1000000
    pulse_length /= 50
    # print('{0}us per period'.format(pulse_length))
    pulse_length /= 4096.0
    #pulse_length = int(pulse_length)
    # print('{0}us per bit'.format(pulse_length))
    pulse *= 1000
    # print(pulse)
    pulse /= pulse_length
    # print(pulse)
    pulse = round(pulse)
    # print(pulse)
    pulse = int(pulse)
    # print (pulse)
    pwm.set_pwm(channel, 0, pulse)

def set_servos(sleepTime):
    set_servo_pulse(0, servo0_pos)
    time.sleep(sleepTime)
    set_servo_pulse(1, servo1_pos)
    time.sleep(sleepTime)
    set_servo_pulse(2, servo2_pos)
    time.sleep(sleepTime)
    set_servo_pulse(3, servo3_pos)
    time.sleep(sleepTime)
    set_servo_pulse(4, servo4_pos)
    time.sleep(sleepTime) 
    set_servo_pulse(5, servo5_pos)
    time.sleep(sleepTime)

def print_servo_pos():
    print(servo0_pos)
    print(servo1_pos)
    print(servo2_pos)
    print(servo3_pos)
    print(servo4_pos)
    print(servo5_pos)

# Saves a single individual position into a file
def savePosition(filename):
    f = open(filename, "w")
    f.write(str(servo0_pos))
    f.write("\n")
    f.write(str(servo1_pos))
    f.write("\n")
    f.write(str(servo2_pos))
    f.write("\n")
    f.write(str(servo3_pos))
    f.write("\n")
    f.write(str(servo4_pos))
    f.write("\n")
    f.write(str(servo5_pos))
    f.close()

# Reads a single individual position from a file and sets the servo-variables for it. Does NOT move the arm to the position.
def loadPosition(filename):
    global servo0_pos
    global servo1_pos
    global servo2_pos
    global servo3_pos
    global servo4_pos
    global servo5_pos
    
    f = open(filename, "r")
    servo0_pos = float(f.readline())
    servo1_pos = float(f.readline())
    servo2_pos = float(f.readline())
    servo3_pos = float(f.readline())
    servo4_pos = float(f.readline())
    servo5_pos = float(f.readline())
    f.close()

# Appends the current position to a record-file.
def appendServoPos(filename):
    f = open(filename, "a")
    f.write(str(servo0_pos))
    f.write("\n")
    f.write(str(servo1_pos))
    f.write("\n")
    f.write(str(servo2_pos))
    f.write("\n")
    f.write(str(servo3_pos))
    f.write("\n")
    f.write(str(servo4_pos))
    f.write("\n")
    f.write(str(servo5_pos))
    f.write("\n")
    f.close()

# Loads a record-file and plays it
def loadInstruction(filename):
    global servo0_pos
    global servo1_pos
    global servo2_pos
    global servo3_pos
    global servo4_pos
    global servo5_pos

    index = 0
    servos = [0, 0, 0, 0, 0, 0]
    firstLine = ""
    pauseBetweenServos = 0
    pauseBetweenSteps = 0
    
    f = open(filename, "r")
    for line in f:
        if firstLine == "":
            firstLine = line.split(",")
            pauseBetweenServos = float(firstLine[0])
            pauseBetweenSteps = float(firstLine[1])
            continue
        
        servos[index % 6] = float(line)
        index = index + 1
        if index % 6 == 0:
            servo0_pos = servos[0]
            servo1_pos = servos[1]
            servo2_pos = servos[2]
            servo3_pos = servos[3]
            servo4_pos = servos[4]
            servo5_pos = servos[5]
            set_servos(pauseBetweenServos)
            time.sleep(pauseBetweenSteps)


    # Change back to default position
    servo0_pos = defaultValue
    servo1_pos = defaultValue
    servo2_pos = defaultValue
    servo3_pos = defaultValue
    servo4_pos = defaultValue
    servo5_pos = defaultValue
    set_servos(0)
    f.close()

def toggleRecordMode():
    global recordMode
    global recordFileName
    global pauseBetweenServos
    global pauseBetweenSteps
    
    recordMode = not recordMode
    if recordMode:
        recordFileName = input("Choose filename: ")
        pauseBetweenServos = int(input("Pause between servos in second: "))
        pauseBetweenSteps = int(input("Pause between steps in second: "))
        f = open(recordFileName, "w")
        f.write("{0},{1}\n".format(pauseBetweenServos, pauseBetweenSteps))
        f.close()
        
    print("Recordmode: " + str(recordMode))
    
def checkForValidServoValues():
    global servo0_pos
    global servo1_pos
    global servo2_pos
    global servo3_pos
    global servo4_pos
    global servo5_pos

    if servo0_pos < minValue: servo0_pos = minValue
    if servo1_pos < minValue: servo1_pos = minValue
    if servo2_pos < minValue: servo2_pos = minValue
    if servo3_pos < minValue: servo3_pos = minValue
    if servo4_pos < minValue: servo4_pos = minValue
    if servo5_pos < minValue: servo5_pos = minValue

    if servo0_pos > maxValue: servo0_pos = maxValue
    if servo1_pos > maxValue: servo1_pos = maxValue
    if servo2_pos > maxValue: servo2_pos = maxValue
    if servo3_pos > maxValue: servo3_pos = maxValue
    if servo4_pos > maxValue: servo4_pos = maxValue
    if servo5_pos > maxValue: servo5_pos = maxValue
    

def initializeMainLoop():
    
    pygame.init();
    screen = pygame.display.set_mode( (640,480) )
    pygame.display.set_caption('Python numbers')
    screen.fill((159, 182, 205))
    
    
def main():
    global servo0_pos
    global servo1_pos
    global servo2_pos
    global servo3_pos
    global servo4_pos
    global servo5_pos
    global recordMode
    global recordFileName
    global steps
    
    set_servos(0)
    initializeMainLoop()
    print("Bereit fuer Eingabe");
    quit = False

    # "keys" gets a list of all pressed keys before checking for them, "pressed" a list of all keys after that.
    # This helps to avoid executing code in the loop that is supposed to be only called once when a key gets pressed down
    keys = []
    pressed = []
    
    while not quit:
        
        pygame.event.pump()
        keys = pygame.key.get_pressed()
        
        if keys[K_ESCAPE]:
            quit = True
            
        if keys[K_LEFT] or keys[K_a]:
            servo0_pos += steps
            checkForValidServoValues()
            set_servos(0)
                
        if keys[K_RIGHT] or keys[K_d]:
            servo0_pos -= steps
            checkForValidServoValues()
            set_servos(0)
        
        if keys[K_UP] or keys[K_w]:
            servo1_pos += steps
            checkForValidServoValues()
            set_servos(0)
        
        if keys[K_DOWN] or keys[K_s]:
            servo1_pos -= steps
            checkForValidServoValues()
            set_servos(0)
        
        if keys[K_r] and not keys[K_LALT]:
            servo2_pos += steps
            checkForValidServoValues()
            set_servos(0)
        
        if keys[K_f]:
            servo2_pos -= steps
            checkForValidServoValues()
            set_servos(0)
        
        if keys[K_t]:
            servo3_pos -= steps
            checkForValidServoValues()
            set_servos(0)
        
        if keys[K_g]:
            servo3_pos += steps
            checkForValidServoValues()
            set_servos(0)
        
        if keys[K_q]:
            servo4_pos -= steps
            checkForValidServoValues()
            set_servos(0)
        
        if keys[K_e]:
            servo4_pos += steps
            checkForValidServoValues()
            set_servos(0)
        
        if keys[K_LCTRL]:
            servo5_pos -= steps
            checkForValidServoValues()
            set_servos(0)
    
        if keys[K_LSHIFT]:
            servo5_pos += steps
            checkForValidServoValues()
            set_servos(0)

        if keys[K_KP_PLUS] and not pressed[K_KP_PLUS]:
            steps *= 2.0
            print("Step size: {0}".format(steps))
            
        if keys[K_KP_MINUS] and not pressed[K_KP_MINUS]:
            steps /= 2.0
            print("Step size: {0}".format(steps))
            
            
        if keys[K_o] and not pressed[K_o]:
            if recordMode:
                appendServoPos(recordFileName)
            else:
                fileName = input("Choose filename: ")
                savePosition(fileName)
        
        if keys[K_l] and not keys[K_LALT]:
            fileName = input("Choose filename: ")
            loadPosition(fileName)
            set_servos(1.5)
        
        if keys[K_p] and not pressed[K_p]:
            print_servo_pos()

        if keys[K_LALT] and keys[K_r] and not pressed[K_r]:
            toggleRecordMode()

        if keys[K_LALT] and keys[K_l]:
            fileName = input("Choose filename: ")
            loadInstruction(fileName)

        pressed = pygame.key.get_pressed()
		
    pygame.quit()

#Call main-function
main()
