#!/usr/bin/python

import sys
import getopt
import datetime
import os.path
import time
import math
import Adafruit_PCA9685

# Robot02 servo variables

servoCount = 6
minValue = 0.4
maxValue = 2.5
defaultValue = 1.5
servos = []
servo_min = 150 # Minimale Pulslaenge
servo_max = 600 # Maximale Pulslaenge
selectedSpeed = 1
speeds = [[0.001, 0.001], [0.01, 0.001], [0.02, 0.001], [1, 0]]

# Filenames

historyFileName = "history"
servoValuesFileName = "lastServoValues"

# CLI-option variables

servoOption   = "Servo"
methodOption  = "Method"
valueOption   = "Value"
servosOption  = "Servos"
fileOption    = "File"
speedOption   = "Speed"
optionPrefix  = "--"
optionPostfix = "="
methods = ["read","write"]
arguments = [servoOption  + optionPostfix,
             methodOption + optionPostfix,
             valueOption  + optionPostfix,
             servosOption + optionPostfix,
             fileOption   + optionPostfix,
             speedOption  + optionPostfix]

useSmooth = True

# Option descriptions

servoOptionDesc  = "Which servo the selecte method should be applied to. Valid values: 1-6."
methodOptionDesc = "Which method should be applied to the selected servo. Valid values: read;write."
valueOptionDesc  = "Which value to write to the selected servo. Only used with the --Method=write option. Valid values: 0.4-2.5."
servosOptionDesc = "A list of comma separated float-values that get assigned to the servo that corresponds the position in the list. If this option gets used, all other given options are getting ignored with exception of the {0}-option".format(fileOption)
fileOptionDesc   = "Path to a file that stores a previous recorded set of values that the robot arms execute step by step. If this option gets used, all other given options are getting ignored."
speedOptionDesc  = "Value that determines the speed for the robotarm movement. Valid values: {0}".format(range(0, len(speeds)))

# Helper function, copied from the official instructions of the Joy-It-Robot02 instructions manual. Used to move the arm.
def set_servo_pulse(channel, pulse, pwm):
    pulse_length = 1000000
    pulse_length /= 50
    #print('{0}us per period'.format(pulse_length))
    pulse_length /= 4096.0
    #print('{0}us per bit'.format(pulse_length))
    pulse *= 1000
    #print(pulse_length)
    pulse /= pulse_length
    #print(pulse)
    pulse = round(pulse)
    #print(pulse)
    pulse = int(pulse)
    #print (pulse)
    pwm.set_pwm(channel, 0, pulse)

# Read servo values from file
def readServoFile(fileName):
    servos=[]
    try:
        with open(fileName, "r") as file:
            for i in range(0, servoCount):
                line = file.readline()
                floatVal = float(line)
                servos.append(floatVal)
    except IOError as ioe:
        print("IOError {0} while trying to read file: {1}".format(ioe.errno, e.strerror))
        raise ioe
    except Exception as e:
        print("Unexpected error: {0}".format(sys.exc_info()[0]))
        raise e

    return servos

# Write servo values to file
def writeServoFile(servos, fileName):
    try:
        with open(fileName, "w") as file:
            for i in range(0, servoCount):
                file.write(str(servos[i]))
                if i < servoCount-1: file.write("\n")
    except IOError as ioe:
        print("IOError {0} while trying to write file: {1}".format(ioe.errno, e.strerror))
        raise ioe
    except Exception as e:
        print("Unexpected error: {0}".format(sys.exc_info()[0]))
        raise e

# Write applied method to history file for later checking
def writeHistoryFile(servo, method, value, fileName):

    today = datetime.datetime.now()
    entry = "{0}: Servo={1}, Method={2}, Value={3}".format(today, servo, method, value)
    
    try:
        with open(fileName, "a") as file:
            file.write(entry)
            file.write("\n")
    except IOError as ioe:
        print("IOError {0} while trying to write historyfile: {1}".format(ioe.errno, e.strerror))
        raise ioe
    except Exception as e:
        print("Unexpected error: {0}".format(sys.exc_info()[0]))
        raise e

def backToDefault():
    servos = [1.5, 1.5, 1.5, 1.5, 1.5, 1.6]
    setServos(servos)
    writeServoFile(servos, servoValuesFileName)
    
def playFile(fileName):
    try:
        index = 0
        firstLine = ""
        pauseBetweenServos = 0
        pauseBetweenSteps = 3
        servos = []
        
        with open(fileName, "r") as file:
            for line in file:
                if firstLine == "":
                    firstLine = line.split(",")
                    print(firstLine)
                    pauseBetweenServos = float(firstLine[0])
                    pauseBetweenSteps = float(firstLine[1])
                    continue
                
                servos.append(float(line))
                index += 1
            
                if(index >= servoCount):
                    setServos(servos, pauseBetweenServos)
                    writeServoFile(servos, servoValuesFileName)
                    time.sleep(pauseBetweenSteps)
                    index = 0
                    servos = []

        backToDefault()
    except IOError as ioe:
        backToDefault()
        print("IOError {0} while trying to read file: {1}".format(ioe.errno, e.strerror))
        raise ioe
    except Exception as e:
        backToDefault()
        print("Unexpected error: {0}".format(sys.exc_info()[0]))
        raise e
        
# Read servo values from a file. If file does not exist, create a file, fill it with default values, and set arm to default.
def getServoValues():
    result = []
    if os.path.isfile(servoValuesFileName):
        result = readServoFile(servoValuesFileName)
    else:
        for i in range(0, servoCount):
            result.append(defaultValue)
            
    return result

def someMath(x):
     result = (-math.cos(x*math.pi)+1)/2
     return result

def setServos(newServos, pauseBetweenServos=0):
    if useSmooth:
        setServosSmooth(newServos, pauseBetweenServos)
    else:
        setServosRigid(newServos, pauseBetweenServos)

# Move robot arm in a smooth way
def setServosSmooth(newServos, pauseBetweenServos=0):
    # Initialisierung mit alternativer Adresse
    pwm = Adafruit_PCA9685.PCA9685(address=0x41)
    # Frequenz auf 50Hz setzen
    pwm.set_pwm_freq(50)

    servos = getServoValues()
    
    steps = speeds[selectedSpeed][0]
    sleep = speeds[selectedSpeed][1]

    diff = []
    
    for i in range(0, servoCount):
        diff.append(newServos[i] - servos[i])

    # Pre-calculate all positions
    x = 0
    index = 0
    newPositions = []
    while x <= 1.0:
        newPositions.append([])
        for i in range(0, servoCount):        
            newPosition = servos[i] + (diff[i] * someMath(x))
            newPositions[index].append(newPosition)

        index += 1
        x += 0.006 # Good value for when both, geth and OPCUA-Server are running. Needs to be adjusted depending how much stressed the CPU is, tough

    # Play precalculated positions
    for position in newPositions:
        for i in range(0, servoCount):
            set_servo_pulse(i, position[i], pwm)
            #time.sleep(0.0001)

    # Set final new position
    for i in range(0, servoCount):
        set_servo_pulse(i, newServos[i], pwm)

# Move robot arm to value in a rigid way
def setServosRigid(newServos, pauseBetweenServos=0):
    
    # Initialisierung mit alternativer Adresse
    pwm = Adafruit_PCA9685.PCA9685(address=0x41)
    # Frequenz auf 50Hz setzen
    pwm.set_pwm_freq(50)

    servos = getServoValues()
    
    steps = speeds[selectedSpeed][0]
    sleep = speeds[selectedSpeed][1]

    diff = []
    value = []
    sig = []
    
    for i in range(0, servoCount):
        diff.append(newServos[i] - servos[i])
        value.append(0.0)
        sig.append(1)
        if(diff[i] < 0):
            sig[i] = -1

    while 1 in sig or -1 in sig:
        for i in range(0, servoCount):
            value[i] += steps
            if value[i] < diff[i]*sig[i]:
               set_servo_pulse(i, servos[i] + value[i]*sig[i], pwm)
            else:
               set_servo_pulse(i, newServos[i], pwm)
               sig[i] = 0
               
        time.sleep(sleep)
        
# Check for valid command line arguments
def validArguments(selectedServo, method, value):
    if selectedServo not in range(1, servoCount+1): return False
    if method not in methods: return False
    if method == methods[1] and value < minValue: return False
    if method == methods[1] and value > maxValue: return False
    return True

# Print useage of command lines
def printUsage():
    usage = "{0}\t{1}\n{2}\t{3}\n{4}\t{5}\n{6}\t{7}\n{8}\t{9}\n{10}\t{11}".format(servoOption, servoOptionDesc, methodOption, methodOptionDesc, valueOption, valueOptionDesc, servosOption, servosOptionDesc, fileOption, fileOptionDesc, speedOption, speedOptionDesc)
    print(usage)
    
def main(argv):

    global servos
    global selectedSpeed

    servos = getServoValues()
    selectedServo = 0;
    method = ""
    value = 0
    fileName = ""
    
    fileUsed = False
    servosUsed = False
    
    try:
        opts, args = getopt.getopt(argv, "h", arguments);

        for opt, arg in opts:
            if opt == "--Init":
                servos = []
                for i in range(0, servoCount):
                    servos[i] = defaultValue
                    writeServoFile(servos, servoValuesFileName)
                    exit(0)
                
            if opt == optionPrefix + servoOption:
                selectedServo = int(arg)
                
            if opt == optionPrefix + methodOption:
                method = arg
                
            if opt == optionPrefix + valueOption:
                value = float(arg)
                
            if opt == optionPrefix + servosOption:
                servosUsed = True
                values = arg.split(",")
                for i in range(0, len(values)):
                    servos[i] = float(values[i])
            if opt == optionPrefix + fileOption:
                fileUsed = True
                fileName = arg
            if opt == optionPrefix + speedOption:
                selectedSpeed = int(arg)
                if selectedSpeed < 0 or selectedSpeed >= len(speeds):
                    print ("Invalid Speednumber. Must in {0}".format(range(0, len(speeds))))
                    printUsage()
                    exit(1)
            if opt == "-h":
                printUsage()
                exit(0)

        if fileUsed:
            playFile(fileName)
        elif servosUsed:
            setServos(servos)
            writeServoFile(servos, servoValuesFileName)
        elif validArguments(selectedServo, method, value):
            writeHistoryFile(selectedServo, method, value, "robotHistory")
            if method == methods[0]:
                print(servos[selectedServo-1])
            elif method == methods[1]:
                servos[selectedServo-1] = value
                setServos(servos)
                writeServoFile(servos, servoValuesFileName)
            else:
                print("Unknown method: {0}".format(method))
                exit(1)
        else:
            print("Invalid arguments")
            printUsage()
            exit(1)
    except getopt.GetoptError:
        print("Error with arguments")
        printUsage()
        sys.exit(2)
    except Exception as e:
        print("Unexpected error: {0}".format(sys.exc_info()[0]))
        raise e

print(sys.argv)
main(sys.argv[1:])
