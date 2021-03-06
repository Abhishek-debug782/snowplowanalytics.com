const form = {
    isValidInput: (type, value) => {
        if (value){
            value = value.trim()
        }
        switch(type) {
            case 'not_empty':
                return (value.length > 1)
            case 'email':
              return /^(([^<>()\[\]\.,;:\s@\"]+(\.[^<>()\[\]\.,;:\s@\"]+)*)|(\".+\"))@(([^<>()[\]\.,;:\s@\"]+\.)+[^<>()[\]\.,;:\s@\"]{2,})$/i.test(value);
        }
    },
    handleSubmit: e => {
        e.preventDefault();
        if(window._userDuid === undefined){
            window._userDuid = '';
        }
        const formLocation = $('#00N2400000JSExF');
        let pass = 1;
        let fieldsToValidate = ['email','first_name','last_name','company'];
        let data = {
            "00N2400000HRtrl" : window._userDuid
        };  
        // Webinars custom validation 
        fieldsToValidate =  $("#main-form").attr("data-gtmEventName").split('-')[0] == 'webinar' ? fieldsToValidate = ['email','first_name'] : fieldsToValidate;
        
        // Lp gartner custom validation
        fieldsToValidate = formLocation && formLocation.val() == 'LP-dataOps-Gartner' ? fieldsToValidate = ['email','first_name','last_name','company','role'] : fieldsToValidate;


        // Heap - Iteratively - Snowplow webinar
         fieldsToValidate = formLocation && formLocation.val() == 'Webinar#7' ? fieldsToValidate = ['email','first_name','last_name','company','role'] : fieldsToValidate;

        // Validate input fields
        $('#main-form input, #main-form textarea').each(function(){                    
            if($.inArray(this.name, fieldsToValidate) !== -1){
                pass = (this.name == 'email') && !form.isValidInput('email',this.value) && $(this).addClass('error')
                || !(this.name == 'email') && !form.isValidInput('not_empty',this.value) && $(this).addClass('error')
                ? pass = 0 : pass;

                data[this.name] =  this.value 
            }
        });
        pass && $('#form_submit_button').addClass('activate-loader') 
             && form.pardotSubmit(data)
    },
    pardotSubmit: data => {
        var url = $("#main-form").attr("data-pardotUrl");
        $.ajax({
            url: url,
            jsonp: "callback",
            dataType: "jsonp",
            data: data
        });
        //Callback Directly from our own assets.Pardot does not allow CORS calls. Success and Error scripts - /assets/js/pardot (callback takes res from there)
        window.callback = function (data) {
    
            // Handle Gartner LP exception
            if(data.result == 'success' && $('#00N2400000JSExF').val() == 'LP-dataOps-Gartner'){
                dataLayer.push({ 'event': $("#main-form").attr("data-gtmEventName") })
                window.location.replace(`${window.location.pathname}thank-you/`)
                return;
            }
           
            //Handle thankyou fadein on success or color every input if pardot error
            (data.result == 'success') 
            ? $('.form-wrap').hide() 
                && $('.thankyou').fadeIn(700)
                // push an event to GTM
                && dataLayer.push({ 'event': $("#main-form").attr("data-gtmEventName") })
            : $('input').addClass('error') 
                && $('#form_submit_button').removeClass('activate-loader')
        }
    }
    
}

// VISUAL HELPERS

//Remove any validation when user tries to rewrite the field
$('input').focus(function(){
    $(this).removeClass('error')
})

// BIND FORM

var mainForm = document.getElementById('main-form');
mainForm && mainForm.addEventListener('submit', form.handleSubmit);


// Temp solution - Scroll on writers program TODO

$("#writers-cta").click(function() {
    $([document.documentElement, document.body]).animate({
        scrollTop: $("#main-form").offset().top -100
    }, 1000);
});

// Pricing page initialize only if present

if($(".pricing-slider")[0]){
    $(".pricing-slider").slick({
        infinite: true,
        slidesToShow: 3,
        slidesToScroll: 1,
        responsive: [
            {
            breakpoint: 810,
            settings: {
              slidesToShow: 1,
              dots: false,
              initialSlide:1
            }
      
          }]
      });
}



if($(".tools-slider")[0]){
    $(".tools-slider").slick({
        infinite: true,
        slidesToShow: 3,
        slidesToScroll: 1,
        dots: false,
        responsive: [
            {
                breakpoint: 1240,
                settings: {
                slidesToShow: 2,
                }
            },
            {
                breakpoint: 810,
                settings: {
                slidesToShow: 3,
                }
            },
            {
                breakpoint: 640,
                settings: {
                slidesToShow: 2,
                }
            },
            {
                breakpoint: 520,
                settings: {
                slidesToShow: 1,
                }
            },
        ]
      });
}



// Webinar listing initialize only if present

if($(".webinar-slide")[0]){
    $(".webinar-slide").slick({
        infinite: false,
        slidesToShow: 1,
        slidesToScroll: 1,
        dots: false,
        autoplay: false,
        arrows : false,
        adaptiveHeight: true
      });
}

// Small clients wrapper  initialize only if present
// TODO: Convert to ES6 after WP MIG
// Allow sliding for buttons and handler active state

function slickGoToWebinarPage(slide){
    // slide to destination
    $('.webinar-slide').slick('slickGoTo', slide) 
    // toggle classes between two elements
    $('.webinar-list .list-categories li').each(function(i){
        $(this).hasClass('active') ? $(this).removeClass('active') : $(this).addClass('active');
    });
} 


// Watch webinar - multi series 

if($(".single-webinar-slider")[0]){
    $(".single-webinar-slider").slick({
        infinite: false,
        slidesToShow: 1,
        slidesToScroll: 1,
        dots: false,
        autoplay: false,
        arrows : false,
        adaptiveHeight: true
        
      });
}

// TODO - Make it capable to support more than 2 button active state management.
// Allow sliding for buttons and handler active state

function sliceGoToSingleWebinarSlide(slide){
    // slide to destination
    $('.single-webinar-slider').slick('slickGoTo', slide) 
} 

$('.single-webinar-list .list-categories li').click(function(){
    sliceGoToSingleWebinarSlide($(this).attr("data-slide"))
    $('.single-webinar-list .list-categories li').removeClass('active')
    $(this).addClass('active')
})




// First init

function initSmallClientSlider(){
    var sliderProps = {
        infinite: true,
        slidesToShow: 5,
        slidesToScroll: 1,
        initialSlide:1,
        dots: false,
        responsive: [
            {
                breakpoint: 1200,
                settings: {
                    slidesToShow: 4
                }
            },
            {
                breakpoint: 940,
                settings: {
                    slidesToShow: 3
                }
            },
            {
                breakpoint: 800,
                settings: {
                    slidesToShow: 2
                }
            },
            {
                breakpoint: 640,
                settings: "unslick"
            }
        ]
    }
    if($(".small-clients-slider")[0]){
        if (window.matchMedia("(max-width: 1375px)").matches) {
            $(".small-clients-slider").slick(sliderProps);
        }else{
            $('.small-clients-slider').slick('unslick');
        }
    }
}


// Handle window resize
$(window).resize(function(){
    initSmallClientSlider();
});
// Handle initial slider activation
$(document).ready(function(){
    initSmallClientSlider();
})


// Pricing page add functionality to hints


$('.questionmark').click(function(e){
    $('.questionmark').next().hide(100);
    $(this).next().show(100);
    e.stopPropagation();
})

$('body').click(function(){
    $('.questionmark').next().hide(100);
});

