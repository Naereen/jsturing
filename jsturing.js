/* JavaScript Turing machine emulator */
/* Anthony Morphett - awmorp@gmail.com */

/* Version 2.0 - September 2014 */
/* Uses jquery (1.11.1) */

/* TODO:
  - more example programs: Fibonacci, brainfuck?
*/

var nDebugLevel = 0;

var bFullSpeed = false;   /* If true, run at full speed with no delay between steps */

var bIsReset = false;   /* true if the machine has been reset, false if it is or has been running */
var sTape = "0110110";
var nHeadPosition = 0;   /* the position of the TM's head on its tape. Initially zero; may be negative if TM moves to left */
var sState = "0";
var nTapeOffset = 0;     /* the logical position on TM tape of the first character of sTape */
var nSteps = 0;
var hRunTimer = null;
var aProgram = new Object();
/* aProgram is a double asociative array, indexed first by state then by symbol.
   Its members are objects with properties newSymbol, action, newState, breakpoint and sourceLineNumber.
*/

/* Variables for the source line numbering, markers */
var nTextareaLines = -1;
var oTextarea;
var bIsDirty = true;	/* If true, source must be recompiled before running machine */
var oNextLineMarker = $("<div id='NextLineMarker'>Next<div id='NextLineMarkerEnd'></div></div>");
var oPrevLineMarker = $("<div id='PrevLineMarker'>Prev<div id='PrevLineMarkerEnd'></div></div>");
var oPrevInstruction = null;
var oNextInstruction = null;


/* FindNextInstruction(): look up the next instruction for the given state and symbol */
function FindNextInstruction(sState, sHeadSymbol)
{
	if( aProgram[sState] != null && aProgram[sState][sHeadSymbol] != null ) {
		/* Use instruction specifically corresponding to current state & symbol, if any */
		return( aProgram[sState][sHeadSymbol] );
	} else if( aProgram[sState] != null && aProgram[sState]["*"] != null ) {
		/* Next use rule for the current state and default symbol, if any */
		return( aProgram[sState]["*"] );
	} else if( aProgram["*"] != null && aProgram["*"][sHeadSymbol] != null ) {
		/* Next use rule for default state and current symbol, if any */
		return( aProgram["*"][sHeadSymbol] );
	} else if( aProgram["*"] != null && aProgram["*"]["*"] != null ) {
		/* Finally use rule for default state and default symbol */
		return( aProgram["*"]["*"] );
	} else return( null );
}

/* Step(): run the Turing machine for one step. Returns false if the machine is in halt state at the end of the step, true otherwise. */
function Step()
{
	if( bIsDirty) Compile();
	
	bIsReset = false;
	if( sState.substring(0,4).toLowerCase() == "halt" ) {
		debug( 1, "Warning: Step() called while in halt state" );
		UpdateStatusMessage( "Halted." );
		return( false );
	}
	
	var sNewState, sNewSymbol, nAction, nLineNumber;
	
	/* Find current symbol (may not be in sTape as sTape only stores modified tape cells) */
	var sHeadSymbol = GetTapeSymbol( nHeadPosition - nTapeOffset );
	
	/* Find appropriate TM instruction */
	var oInstruction = FindNextInstruction( sState, sHeadSymbol );
	
	if( oInstruction != null ) {
		sNewState = (oInstruction.newState == "*" ? sState : oInstruction.newState);
		sNewSymbol = (oInstruction.newSymbol == "*" ? sHeadSymbol : oInstruction.newSymbol);
		nAction = (oInstruction.action.toLowerCase() == "r" ? 1 : (oInstruction.action.toLowerCase() == "l" ? -1 : 0));
		nLineNumber = oInstruction.sourceLineNumber;
	} else {
		/* No matching rule found; halt */
		debug( 1, "Warning: no instruction found for state '" + sState + "' symbol '" + sHeadSymbol + "'; halting" );
		UpdateStatusMessage( "No rule for state '" + sState + "', symbol '" + sHeadSymbol + "'. Halted." );
		sNewState = "halt-error";
		sNewSymbol = sHeadSymbol;
		nAction = 0;
		nLineNumber = -1;
	}
	
	/* Update machine tape & state */
	SetTapeSymbol( nHeadPosition, sNewSymbol );
	sState = sNewState;
	nHeadPosition += nAction;
	
	nSteps++;
	
	oPrevInstruction = oInstruction;
	oNextInstruction = FindNextInstruction( sNewState, GetTapeSymbol( nHeadPosition - nTapeOffset ) );
	
	debug( 4, "Step() finished. New tape: '" + sTape + "'  new state: '" + sState + "'  action: " + nAction + "  line number: " + nLineNumber  );
	UpdateInterface();
	
	if( sNewState.substring(0,4).toLowerCase() == "halt" ) {
		if( oInstruction != null ) {
			UpdateStatusMessage( "Halted." );
		} 
		EnableControls( false, false, false, true, true, true );
		return( false );
	} else {
		if( oInstruction.breakpoint ) {
			UpdateStatusMessage( "Stopped at breakpoint on line " + nLineNumber );
			if( hRunTimer != null ) {
				EnableControls( true, true, false, true, true, true );
				StopTimer();
			}
			return( false );
		} else {
			return( true );
		}
	}
}


/* Run(): run the TM until it halts or until user interrupts it */
function Run()
{
  var bContinue = true;
  if( bFullSpeed ) {
    /* Run 25 steps at a time in fast mode */
    for( var i = 0; bContinue && i < 25; i++ ) {
      bContinue = Step();
    }
    if( bContinue ) hRunTimer = window.setTimeout( Run, 10 );
    else UpdateInterface();   /* Sometimes updates get lost at full speed... */
  } else {
    /* Run a single step every 50ms in slow mode */
    if( Step() ) {
      hRunTimer = window.setTimeout( Run, 50 );
    }
  }
}

/* RunStep(): triggered by the run timer. Calls Step(); stops running if Step() returns false. */
function RunStep()
{
	if( !Step() ) {
		StopTimer();
	}
}

/* StopTimer(): Deactivate the run timer. */
function StopTimer()
{
	if( hRunTimer != null ) {
		window.clearInterval( hRunTimer );
		hRunTimer = null;
	}
}


/* Reset( sInitialTape ): restore the TM state etc to its initial value and load the tape with sInitialTape */
function Reset( sInitialTape )
{
	if( sInitialTape == null ) sInitialTape = "";
	sTape = sInitialTape;
	nSteps = 0;
	nHeadPosition = 0;
	nTapeOffset = 0;
	sState = "0";
	bIsReset = true;
	
	Compile();
	oPrevInstruction = null;
	oNextInstruction = FindNextInstruction( sState, GetTapeSymbol( nHeadPosition - nTapeOffset ) );
	
	UpdateInterface();
}


/* GetTapeSymbol( n ): returns the symbol at cell n of the TM tape */
function GetTapeSymbol( n )
{
	if( n >= sTape.length || n < 0 ) {
		return( "_" );
	} else {
		var c = sTape.charAt( n );
		if( c == " " ) { c = "_"; debug( 4, "GetTapeSymbol() got SPACE not _ !!!" ); }
		return( c );
	}
}

/* SetTapeSymbol( n, c ): writes symbol c to cell n of the TM tape */
function SetTapeSymbol( nPos, c )
{
	var n = nPos - nTapeOffset;
	debug( 4, "SetTapeSymbol( " + nPos + ", " + c + " ); n = " + n + "; nTapeOffset = " + nTapeOffset );
	if( c == " " ) { c = "_"; debug( 4, "SetTapeSymbol() with SPACE not _ !!!" ); }
	if( n >= 0 && n < sTape.length ) {
		sTape = sTape.substr( 0, n ) + c + sTape.substr( n + 1 );
		debug( 5, "  n >= 0 && n < sTape.length; sTape = '" + sTape + "'" );
	} else if( n < 0 && c != "_" ) {
		sTape = c + repeat( "_", -1 - n ) + sTape;
		nTapeOffset += n;
		debug( 5, "  n < 0 && c != '_'; sTape = '" + sTape + "'  nTapeOffset = " + nTapeOffset );
	} else if( c != "_" ) { /* n >= sTape.length */
		sTape = sTape + repeat( "_", n - sTape.length ) + c;
		debug( 5, " c != ' ' && n >= sTape.length; sTape = '" + sTape + "'" );
	}
}

/* RenderTape(): show the tape contents and head position in the MachineTape div */
function RenderTape()
{
	/* calculate the strings:
	  sFirstPart is the portion of the tape to the left of the head
	  sHeadSymbol is the symbol under the head
	  sSecondPart is the portion of the tape to the right of the head
	*/
	var nTranslatedHeadPosition = nHeadPosition - nTapeOffset;  /* position of the head relative to sTape */
	var sFirstPart, sHeadSymbol, sSecondPart;
	debug( 4, "translated head pos: " + nTranslatedHeadPosition + "  head pos: " + nHeadPosition + "  tape offset: " + nTapeOffset );
	debug( 4, "sTape = '" + sTape + "'" );

	if( nTranslatedHeadPosition > 0 ) {
		sFirstPart = sTape.substr( 0, nTranslatedHeadPosition );
	} else {
		sFirstPart = "";
	}
	if( nTranslatedHeadPosition > sTape.length ) {  /* need to append blanks to sFirstPart */
		sFirstPart += repeat( " ", nTranslatedHeadPosition - sTape.length );
	}
	sFirstPart = sFirstPart.replace( /_/g, " " );
	
	if( nTranslatedHeadPosition >= 0 && nTranslatedHeadPosition < sTape.length ) {
		sHeadSymbol = sTape.charAt( nTranslatedHeadPosition );
	} else {
		sHeadSymbol = " ";
	}
	sHeadSymbol = sHeadSymbol.replace( /_/g, " " );
	
	if( nTranslatedHeadPosition >= 0 && nTranslatedHeadPosition < sTape.length - 1 ) {
		sSecondPart = sTape.substr( nTranslatedHeadPosition + 1 );
	} else if( nTranslatedHeadPosition < 0 ) {  /* need to prepend blanks to sSecondPart */
		sSecondPart = repeat( " ", -nTranslatedHeadPosition - 1 ) + sTape;
	} else {  /* nTranslatedHeadPosition > sTape.length */
		sSecondPart = "";
	}
	sSecondPart = sSecondPart.replace( /_/g, " " );
	
	debug( 4, "RenderTape(): sFirstPart = '" + sFirstPart + "' sHeadSymbol = '" + sHeadSymbol + "'  sSecondPart = '" + sSecondPart + "'" );
	
	/* Display the parts of the tape */
	$("#LeftTape").text( sFirstPart );
	$("#ActiveTape").text( sHeadSymbol );
	$("#RightTape").text( sSecondPart );
	debug( 4, "RenderTape(): LeftTape = '" + $("#LeftTape").text() + "' ActiveTape = '" + $("#ActiveTape").text() + "' RightTape = '" + $("#RightTape").text() + "'" );
	
	/* If reset, display the initial input box; if not, display the tape */
/*	if( bIsReset ) {
		$( "#RunningTapeDisplay" ).toggle( false );
		$( "#InitialTapeDisplay" ).toggle( true ); 
	} else {
		$( "#RunningTapeDisplay" ).toggle( true );
		$( "#InitialTapeDisplay" ).toggle( false ); 
	
	}
*/
}

function RenderState()
{
	$("#MachineState").html( sState );
}

function RenderSteps()
{
	$("#MachineSteps").html( nSteps );
}

function RenderLineMarkers()
{
	debug( 3, "Rendering line markers: " + (oNextInstruction?oNextInstruction.sourceLineNumber:-1) + " " + (oPrevInstruction?oPrevInstruction.sourceLineNumber:-1) );
	SetActiveLines( (oNextInstruction?oNextInstruction.sourceLineNumber:-1), (oPrevInstruction?oPrevInstruction.sourceLineNumber:-1) );
}

/* UpdateStatusMessage( sString ): display sString in the status message area */
function UpdateStatusMessage( sString )
{
	$("#MachineStatusMessagesContainer" ).html( sString );
}

/* UpdateInterface(): refresh the tape, state and steps displayed on the page */
function UpdateInterface()
{
	RenderTape();
	RenderState();
	RenderSteps();
	RenderLineMarkers();
}

/* SetSyntaxMessage(): display a syntax error message in the textarea */
function SetSyntaxMessage( msg )
{
	$("#SyntaxMsg").html( (msg?msg:"&nbsp;") )
}


/* Compile(): parse the inputted program and store it in aProgram */
function Compile()
{
	var sSource = oTextarea.value;
	debug( 2, "Compile()" );
	
	/* Clear syntax error messages */
	SetSyntaxMessage( null );
	ClearErrorLines();
	
	/* clear the old program */
	aProgram = new Object;
	
	sSource = sSource.replace( /\r/g, "" );	/* Internet Explorer uses \n\r, other browsers use \n */
	
	var aLines = sSource.split("\n");
	for( var i = 0; i < aLines.length; i++ )
	{
		var oTuple = ParseLine( aLines[i], i );
		if( oTuple.isValid ) {
			debug( 5, " Parsed tuple: '" + oTuple.currentState + "'  '" + oTuple.currentSymbol + "'  '" + oTuple.newSymbol + "'  '" + oTuple.action + "'  '" + oTuple.newState + "'" );
			if( aProgram[oTuple.currentState] == null ) aProgram[oTuple.currentState] = new Object;
			if( aProgram[oTuple.currentState][oTuple.currentSymbol] != null ) {
				debug( 1, "Warning: multiple definitions for state '" + oTuple.currentState + "' symbol '" + oTuple.currentSymbol + "' on lines " + (aProgram[oTuple.currentState][oTuple.currentSymbol].sourceLineNumber+1) + " and " + (i+1) );
				SetSyntaxMessage( "Warning: Multiple definitions for state '" + oTuple.currentState + "' symbol '" + oTuple.currentSymbol + "' on lines " + (aProgram[oTuple.currentState][oTuple.currentSymbol].sourceLineNumber+1) + " and " + (i+1) );
				SetErrorLine( i );
				SetErrorLine( aProgram[oTuple.currentState][oTuple.currentSymbol].sourceLineNumber );
				
				
			}
			aProgram[oTuple.currentState][oTuple.currentSymbol] = new Object;
			aProgram[oTuple.currentState][oTuple.currentSymbol].newSymbol = oTuple.newSymbol;
			aProgram[oTuple.currentState][oTuple.currentSymbol].action = oTuple.action;
			aProgram[oTuple.currentState][oTuple.currentSymbol].newState = oTuple.newState;
			aProgram[oTuple.currentState][oTuple.currentSymbol].sourceLineNumber = i;
			aProgram[oTuple.currentState][oTuple.currentSymbol].breakpoint = oTuple.breakpoint;
		}
		else if( oTuple.error )
		{
			/* Syntax error */
			debug( 2, "Syntax error: " + oTuple.error );
			SetSyntaxMessage( oTuple.error );
			SetErrorLine( i );
		}
	}
	
	/* Set debug level, if specified */
	oRegExp = new RegExp( ";.*\\$DEBUG: *(.+)" );
	aResult = oRegExp.exec( sSource );
	if( aResult != null && aResult.length >= 2 ) {
		var nNewDebugLevel = parseInt( aResult[1] );
		if( nNewDebugLevel != nDebugLevel ) {
			nDebugLevel = parseInt( aResult[1] );
			debug( 1, "Setting debug level to " + nDebugLevel );
			if( nDebugLevel > 0 ) $(".DebugClass").toggle( true );
		}
	}
	
	/* Lines have changed. Previous line is no longer meaningful, recalculate next line. */
	oPrevInstruction = null;
	oNextInstruction = FindNextInstruction( sState, GetTapeSymbol( nHeadPosition - nTapeOffset ) );
	
	bIsDirty = false;
	
	UpdateInterface();
}

function ParseLine( sLine, nLineNum )
{
	/* discard anything following ';' */
	debug( 5, "ParseLine( " + sLine + " )" );
	sLine = sLine.split( ";", 1 )[0];

	/* split into tokens - separated by tab or space */
	var aTokens = sLine.split(/\s+/);
	aTokens = aTokens.filter( function (arg) { return( arg != "" ) ;} );
/*	debug( 5, " aTokens.length: " + aTokens.length );
	for( var j in aTokens ) {
		debug( 1, "  aTokens[ " + j + " ] = '" + aTokens[j] + "'" );
	}*/

	var oTuple = new Object;
	
	if( aTokens.length == 0 )
	{
		/* Blank or comment line */
		oTuple.isValid = false;
		return( oTuple );
	}
	
	oTuple.currentState = aTokens[0];
	
	if( aTokens.length < 2 ) {
		oTuple.isValid = false;
		oTuple.error = "Syntax error on line " + (nLineNum + 1) + ": missing current symbol!" ;
		return( oTuple );
	}
	if( aTokens[1].length > 1 ) {
		oTuple.isValid = false;
		oTuple.error = "Syntax error on line " + (nLineNum + 1) + ": current symbol should be a single character!" ;
		return( oTuple );
	}
	oTuple.currentSymbol = aTokens[1];
	
	if( aTokens.length < 3 ) {
		oTuple.isValid = false;
		oTuple.error = "Syntax error on line " + (nLineNum + 1) + ": missing new symbol!" ;
		return( oTuple );
	}
	if( aTokens[2].length > 1 ) {
		oTuple.isValid = false;
		oTuple.error = "Syntax error on line " + (nLineNum + 1) + ": new symbol should be a single character!" ;
		return( oTuple );
	}
	oTuple.newSymbol = aTokens[2];
	
	if( aTokens.length < 4 ) {
		oTuple.isValid = false;
		oTuple.error = "Syntax error on line " + (nLineNum + 1) + ": missing direction!" ;
		return( oTuple );
	}
	if( ["l","r","*"].indexOf( aTokens[3].toLowerCase() ) < 0 ) {
		oTuple.isValid = false;
		oTuple.error = "Syntax error on line " + (nLineNum + 1) + ": direction should be 'l', 'r' or '*'!";
		return( oTuple );
	}
	oTuple.action = aTokens[3].toLowerCase();

	if( aTokens.length < 5 ) {
		oTuple.isValid = false;
		oTuple.error = "Syntax error on line " + (nLineNum + 1) + ": missing new state!" ;
		return( oTuple );
	}
	oTuple.newState = aTokens[4];
	
	if( aTokens.length > 6 ) {
		oTuple.isValid = false;
		oTuple.error = "Syntax error on line " + (nLineNum + 1) + ": too many entries!" ;
		return( oTuple );
	}
	if( aTokens.length == 6 ) {		/* Anything other than '!' in position 6 is an error */
		if( aTokens[5] == "!" ) {
			oTuple.breakpoint = true;
		} else {
			oTuple.isValid = false;
			oTuple.error = "Syntax error on line " + (nLineNum + 1) + ": too many entries!";
			return( oTuple );
		}
	} else {
		oTuple.breakpoint = false;
	}

	oTuple.isValid = true;
	return( oTuple );
}

/* return a string of n copies of c */
function repeat( c, n )
{
	var sTmp = "";
	while( n-- > 0 ) sTmp += c;
	return sTmp;
}


function debug( n, str )
{
	if( n <= 0 ) {
		UpdateStatusMessage( str );
	}
	if( nDebugLevel >= n  ) {
		$("#debug").append( document.createTextNode( str + "\n" ) );
	}
}

function ClearDebug()
{
	$("#debug").empty();
}

function EnableControls( bStep, bRun, bStop, bReset, bSpeed, bTextarea )
{
  document.getElementById( 'StepButton' ).disabled = !bStep;
  document.getElementById( 'RunButton' ).disabled = !bRun;
  document.getElementById( 'StopButton' ).disabled = !bStop;
  document.getElementById( 'ResetButton' ).disabled = !bReset;
  document.getElementById( 'SpeedCheckbox' ).disabled = !bSpeed;
  document.getElementById( 'Source' ).disabled = !bTextarea;
  
  if( bSpeed ) {
    $( "#SpeedCheckboxLabel" ).removeClass( "disabled" );
  } else {
    $( "#SpeedCheckboxLabel" ).addClass( "disabled" );
  }
}

/* Trigger functions for the buttons */

function StepButton()
{
	UpdateStatusMessage( " " );
	Step();
}

function RunButton()
{
	UpdateStatusMessage( "Running..." );
	/* Make sure that the step interval is up-to-date */
	SpeedCheckbox();
	EnableControls( false, false, true, false, false, false );
	Run();
}

function StopButton()
{
	if( hRunTimer != null ) {
		UpdateStatusMessage( "Paused; click 'Run' or 'Step' to resume." );
		EnableControls( true, true, false, true, true, true );
		StopTimer();
	}
}

function ResetButton()
{
	UpdateStatusMessage( "Machine reset." );
	Reset( $.trim($("#InitialInput" )[0].value) );
	EnableControls( true, true, false, true, true, true );
}

function SpeedCheckbox()
{
  bFullSpeed = $( '#SpeedCheckbox' )[0].checked;
}

function LoadProgram( zName, bResetWhenLoaded )
{
	debug( 1, "Load '" + zName + "'" );
	var zFileName = "machines/" + zName + ".txt";
	var oRequest = new XMLHttpRequest();
	oRequest.onreadystatechange = function()
	{
		if( oRequest.readyState == 4 )
		{
			/* Load the default initial tape, if any */
			var oRegExp = new RegExp( ";.*\\$INITIAL_TAPE:? *(.+)$" );
			var sData = oRequest.responseText;
			var aResult = oRegExp.exec( sData );
			if( aResult != null && aResult.length >= 2 ) {
				debug( 4, "Parsed initial tape: '" + aResult + "' length: " + (aResult == null ? "null" : aResult.length) );
				$("#InitialInput")[0].value = aResult[1];
				sData = sData.replace( /^.*\$INITIAL_TAPE:.*$/m, "" );
			}

			/* Load the program */
			oTextarea.value = sData;
			TextareaChanged();
			Compile();
			
			/* Reset the machine to load the new tape, etc, if required */
			/* This is necessary only when loading the default program for the first time */
			if( bResetWhenLoaded ) {
				Reset( $('#InitialInput' )[0].value );
			}
		}
	};
	
	oRequest.open( "GET", zFileName, true );
	oRequest.send( null );
}

/* onchange function for textarea */
function TextareaChanged()
{
	/* Update line numbers only if number of lines has changed */
	var nNewLines = (oTextarea.value.match(/\n/g) ? oTextarea.value.match(/\n/g).length : 0) + 1;
	if( nNewLines != nTextareaLines ) {
		nTextareaLines = nNewLines
		UpdateTextareaDecorations();
	}
	
//	Compile();
	bIsDirty = true;
	oPrevInstruction = null;
	oNextInstruction = null;
	RenderLineMarkers();
}

/* Generate line numbers for each line in the textarea */
function UpdateTextareaDecorations()
{
	var oBackgroundDiv = $("#SourceBackground");
	
	oBackgroundDiv.empty();
	
	var sSource = oTextarea.value;
	sSource = sSource.replace( /\r/g, "" );	/* Internet Explorer uses \n\r, other browsers use \n */
	
	var aLines = sSource.split("\n");
	
	for( var i = 0; i < aLines.length; i++)
	{
		oBackgroundDiv.append($("<div id='talinebg"+(i+1)+"' class='talinebg'><div class='talinenum'>"+(i+1)+"</div></div>"));
	}
	
	UpdateTextareaScroll();
}

/* Highlight given lines as the next/previous tuple */
function SetActiveLines( next, prev )
{
	$(".talinebgnext").removeClass('talinebgnext');
	oNextLineMarker.detach().removeClass('shifted');
	$(".talinebgprev").removeClass('talinebgprev');
	oPrevLineMarker.detach().removeClass('shifted');
	
	if( next >= 0 )
	{
		$("#talinebg"+(next+1)).addClass('talinebgnext').prepend(oNextLineMarker);
	}
	if( prev >= 0)
	{
		if( prev != next ) {
			$("#talinebg"+(prev+1)).addClass('talinebgprev').prepend(oPrevLineMarker);
		} else {
			$("#talinebg"+(prev+1)).prepend(oPrevLineMarker);
			oNextLineMarker.addClass('shifted');
			oPrevLineMarker.addClass('shifted');
			
		}
	}
}

/* Highlight given line as an error */
function SetErrorLine( num )
{
	$("#talinebg"+(num+1)).addClass('talinebgerror');
}

/* Clear error highlights from all lines */
function ClearErrorLines()
{
	$(".talinebg").removeClass('talinebgerror');
}

/* Update the line numbers when textarea is scrolled */
function UpdateTextareaScroll()
{
	var oBackgroundDiv = $("#SourceBackground");
	
	$(oBackgroundDiv).css( {'margin-top': (-1*$(oTextarea).scrollTop()) + "px"} );
}

/* Initialise once page is loaded */
function OnLoad()
{
	if( nDebugLevel > 0 ) $(".DebugClass").toggle( true );

	oTextarea = $("#Source")[0];
	TextareaChanged();
	
	LoadProgram( 'concatenate', true );
	
	UpdateStatusMessage( 'Load or write a Turing program below and click Run!' );
}

